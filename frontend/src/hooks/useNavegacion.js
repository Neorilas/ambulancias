import { useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

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

/** Número de página de la URL (≥ 1; lo que no lo sea, la 1). */
export const paginaDeUrl = (valor) => Math.max(1, Math.floor(Number(valor)) || 1);
