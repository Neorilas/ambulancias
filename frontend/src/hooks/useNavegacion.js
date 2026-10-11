import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useDebounce } from './useDebounce.js';

/**
 * Navegación con continuidad: «atrás» vuelve a donde se estaba, como se
 * estaba. Reglas en el §8 del mapa («La navegación hacia atrás»).
 */

/**
 * ¿Hay una pantalla de la app detrás de esta en el historial? No la hay en la
 * primera entrada: un aviso push que abre una ventana nueva, un enlace pegado o
 * un marcador. `key === 'default'` es esa primera entrada en el router de
 * memoria (tests); en el navegador, el router guarda en `history.state.idx` la
 * posición, que un `replace` conserva (la `key`, no).
 */
export function hayAtrasEnLaApp(location) {
  if (location.key === 'default') return false;
  const idx = window.history.state?.idx;
  return typeof idx !== 'number' || idx > 0;
}

/**
 * Lo que hace un botón «‹ Volver»: la pantalla anterior, con sus filtros, su
 * pestaña y su día. Sin pantalla anterior, `alternativa` (el listado de donde
 * cuelga), en vez de no hacer nada o sacar de la app.
 */
export function useVolver(alternativa = '/') {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (hayAtrasEnLaApp(location)) navigate(-1);
    else navigate(alternativa, { replace: true });
  }, [navigate, location, alternativa]);
}

/**
 * Estado de una pantalla que tiene que sobrevivir a ir a una ficha y volver
 * (página, filtros, pestaña, mes…): vive en la URL y no en `useState`, que se
 * pierde al desmontar. Los valores son siempre cadenas; el que vale lo de por
 * defecto no se escribe, para que la URL de la pantalla «limpia» siga siendo
 * la de siempre. Se escribe con `replace`: mirar páginas y filtros no deja
 * rastro y «atrás» sale de la pantalla, no recorre lo que se tocó.
 *
 * OJO: `cambiar` parte de la URL de este render. Dos llamadas seguidas se
 * pisan; lo que cambia junto (un filtro y volver a la página 1) va en una.
 *
 * @param {Object<string,string>} porDefecto clave en la URL → valor por defecto
 */
export function useEstadoEnUrl(porDefecto) {
  const [params, setParams] = useSearchParams();
  const valores = {};
  for (const [k, def] of Object.entries(porDefecto)) valores[k] = params.get(k) ?? def;

  const cambiar = (cambios) => {
    const siguiente = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) {
      if (v == null || v === '' || String(v) === String(porDefecto[k] ?? '')) siguiente.delete(k);
      else siguiente.set(k, String(v));
    }
    setParams(siguiente, { replace: true });
  };
  return [valores, cambiar];
}

/**
 * Un panel que se abre ENCIMA de la pantalla (el detalle de una asignación,
 * sus pasos de inicio y fin) y que el «atrás» del móvil tiene que cerrar, en
 * vez de sacar de la pantalla entera. Abierto = `?<clave>=<valor>` en la URL,
 * puesto con push y marcado en el estado de la navegación: «atrás» lo quita
 * y el panel se cierra solo. `cerrar` (su botón) deshace esa entrada si la
 * puso la app; si llegó de fuera (un enlace con el parámetro), lo quita con
 * `replace`. `alCerrar` corre se cierre como se cierre (para recargar lo de
 * debajo). Con `soloDesdeLaApp`, un parámetro que no puso la app se ignora:
 * un paso de un flujo no se abre desde un enlace.
 *
 * @returns {[string|null, (valor) => void, () => void]} [abierto, abrir, cerrar]
 */
export function usePanelEnUrl(clave, { alCerrar, soloDesdeLaApp = false } = {}) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { state, key } = useLocation();
  const loPusoLaApp = state?.panel === clave;
  const valor = params.get(clave);
  const abierto = valor && (!soloDesdeLaApp || loPusoLaApp) ? valor : null;

  // `cerrar` puede llegar desde un render viejo (al acabar una subida larga,
  // con el panel ya cerrado por «atrás»): mira la URL de ahora, no la de entonces
  const actual = useRef(null);
  actual.current = { params, loPusoLaApp };
  // `navigate(-1)` no se aplica hasta el siguiente render: un segundo `cerrar`
  // antes de eso retrocedería otra vez y sacaría de la pantalla. Y desmontado
  // el dueño (un «atrás» le ganó), un `cerrar` tardío ya no es suyo
  const cerrando = useRef(false);
  useEffect(() => { cerrando.current = false; }, [key]);
  const montado = useRef(false);
  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  const abrir = (v) => {
    const siguiente = new URLSearchParams(params);
    siguiente.set(clave, String(v));
    setParams(siguiente, { state: { panel: clave } });
  };
  const cerrar = () => {
    if (!montado.current || cerrando.current) return;
    const { params: ahora, loPusoLaApp: puesta } = actual.current;
    if (!ahora.has(clave)) return;
    if (puesta) { cerrando.current = true; navigate(-1); return; }
    const siguiente = new URLSearchParams(ahora);
    siguiente.delete(clave);
    setParams(siguiente, { replace: true });
  };

  const alCerrarRef = useRef(alCerrar);
  alCerrarRef.current = alCerrar;
  const antes = useRef(abierto);
  useEffect(() => {
    if (antes.current && !abierto) alCerrarRef.current?.();
    antes.current = abierto;
  }, [abierto]);

  return [abierto, abrir, cerrar];
}

/**
 * El texto de un buscador cuyo valor vive en la URL. El campo NO se ata a la
 * URL directamente: el router aplica cada cambio de ubicación en una
 * transición, el `value` llega un render tarde y React devuelve el campo al
 * texto viejo entre medias — salta el cursor, se pierden teclas en un móvil
 * lento y el autocompletado del teclado se lía. Se escribe en un estado
 * local y llega a la URL ya reposado (`escribir`, que es donde se vuelve a la
 * página 1). Si la URL cambia por fuera (atrás, adelante, un enlace), el
 * campo la sigue.
 *
 * @returns {[string, (texto: string) => void]} [texto, setTexto]
 */
export function useBuscadorEnUrl(valorUrl, escribir, ms = 400) {
  const [texto, setTexto] = useState(valorUrl);
  // Lo último que la URL tiene, o va a tener por lo que escribimos, y lo
  // escrito que aún no ha llegado: en un móvil lento puede salir una segunda
  // escritura antes de que se aplique la primera, y la llegada de esa primera
  // no es un cambio «de fuera» (devolvería el campo al texto anterior)
  const enUrl = useRef(valorUrl);
  const escritos = useRef([]);
  useEffect(() => {
    const i = escritos.current.indexOf(valorUrl);
    if (i !== -1) { escritos.current = escritos.current.slice(i + 1); return; }
    if (valorUrl === enUrl.current) return;
    enUrl.current = valorUrl;
    escritos.current = [];
    setTexto(valorUrl);
  }, [valorUrl]);

  const escribirRef = useRef(escribir);
  escribirRef.current = escribir;
  const reposado = useDebounce(texto, ms);
  useEffect(() => {
    if (reposado === enUrl.current) return;
    enUrl.current = reposado;
    escritos.current.push(reposado);
    escribirRef.current(reposado);
  }, [reposado]);

  return [texto, setTexto];
}

/** Número de página de la URL (≥ 1; lo que no lo sea, la 1). */
export const paginaDeUrl = (valor) => {
  const n = Math.floor(Number(valor));
  return Number.isFinite(n) && n >= 1 ? n : 1;
};
