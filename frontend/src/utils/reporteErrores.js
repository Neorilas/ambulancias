/**
 * utils/reporteErrores.js
 * Manda al backend (POST /errores-cliente → error_logs, origen 'cliente') los
 * errores que ve la app y que nunca llegan a Express: una subida que agota el
 * timeout con mala cobertura, un 502/503 de Caddy durante un deploy, un fallo
 * de JavaScript. Sin esto el panel Errores del superadmin solo veía los 5xx de
 * Express y llevaba meses vacío mientras los técnicos sí veían fallos.
 *
 * Qué se reporta (lo decide quien llama: api.js y los manejadores globales):
 * - Petición sin respuesta (timeout / sin red) que NO es GET: un GET que falla
 *   sin cobertura es el sondeo de alarmas cada 30 s y llenaría el panel de
 *   ruido; lo que importa es la acción del técnico que no ha salido.
 * - 502/503/504 de cualquier método: es el proxy, el backend no llegó a verlo.
 * - Errores de JS y promesas rechazadas sin capturar (no las de axios).
 *
 * Cómo:
 * - Cola en localStorage (con el prefijo del entorno): sin red no se puede
 *   mandar nada en el momento, se manda cuando vuelve.
 * - El mismo error repetido en VENTANA_REPETIDO_MS no añade fila: suma `veces`
 *   (los reintentos de una subida dan un error por intento).
 * - Cada error lleva el id del usuario que lo vio; al mandar se descartan los
 *   de otro usuario, que si no se apuntarían al que ha entrado después.
 * - El envío va con `_sinReporteDeError` para que su propio fallo no se
 *   reporte a sí mismo en bucle.
 */

import { getItem, setItem, removeItem } from './sessionStorage.js';
// Ciclo con api.js (que importa reportarErrorDePeticion): es inofensivo porque
// aquí `api` solo se usa dentro de enviarPendientes, nunca al cargar el módulo.
import api from '../services/api.js';

const CLAVE_COLA          = 'erroresPendientes';
export const COLA_MAX     = 30;
export const LOTE_MAX     = 20;   // el mismo que acepta el backend
const VENTANA_REPETIDO_MS = 5 * 60 * 1000;
const ESPERA_ENVIO_MS     = 3000;

function leerCola() {
  try {
    const cola = JSON.parse(getItem(CLAVE_COLA) || '[]');
    return Array.isArray(cola) ? cola : [];
  } catch {
    return [];
  }
}

function guardarCola(cola) {
  if (cola.length) setItem(CLAVE_COLA, JSON.stringify(cola));
  else removeItem(CLAVE_COLA);
}

function usuarioActualId() {
  try { return JSON.parse(getItem('user') || 'null')?.id ?? null; }
  catch { return null; }
}

/** Ruta de la página sin query ni fragmento (pueden llevar datos). */
function paginaActual() {
  try { return window.location.pathname; } catch { return null; }
}

/** URL de la petición sin query string. */
function sinQuery(url) {
  return typeof url === 'string' ? url.split(/[?#]/)[0] : null;
}

const claveDe = (x) => [x.tipo, x.mensaje, x.url, x.metodo, x.usuario_id].join('|');

// Último instante en que se apuntó cada error, en memoria. La cola sola no
// basta para no repetir: lo ya enviado sale de ella, y un error de JS en cada
// render mandaría un lote cada pocos segundos hasta topar con el 429.
const vistosRecientes = new Map();
const VISTOS_MAX = 200;

/** Identificador de la entrada: borrar lo enviado por id y no por contenido. */
function nuevoId() {
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch { /* sin crypto */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Apunta un error en la cola y programa el envío.
 * @param {{ tipo: 'red'|'timeout'|'http'|'js'|'promesa', mensaje: string,
 *           url?: string, metodo?: string, status?: number, stack?: string }} e
 */
export function registrarError(e, ahoraMs = Date.now()) {
  try {
    if (!e?.tipo || !e?.mensaje) return;
    const entrada = {
      id:          nuevoId(),
      tipo:        e.tipo,
      mensaje:     String(e.mensaje).slice(0, 2000),
      url:         sinQuery(e.url),
      metodo:      e.metodo ? String(e.metodo).toUpperCase() : null,
      status:      Number.isInteger(e.status) ? e.status : null,
      stack:       e.stack ? String(e.stack).slice(0, 8000) : null,
      pagina:      paginaActual(),
      ocurrido_at: new Date(ahoraMs).toISOString(),
      usuario_id:  usuarioActualId(),
      veces:       1,
    };

    const clave = claveDe(entrada);
    const cola = leerCola();
    const repetido = cola.find((x) => claveDe(x) === clave
      && ahoraMs - Date.parse(x.ocurrido_at) < VENTANA_REPETIDO_MS);
    if (repetido) {
      repetido.veces = (repetido.veces || 1) + 1;
    } else if (ahoraMs - (vistosRecientes.get(clave) ?? -Infinity) < VENTANA_REPETIDO_MS) {
      // Ya se apuntó (y probablemente se envió) hace menos de 5 min: se calla.
      return;
    } else {
      vistosRecientes.set(clave, ahoraMs);
      if (vistosRecientes.size > VISTOS_MAX) vistosRecientes.delete(vistosRecientes.keys().next().value);
      cola.push(entrada);
      // Llena, se quedan los más recientes.
      cola.splice(0, Math.max(0, cola.length - COLA_MAX));
    }
    guardarCola(cola);
    programarEnvio();
  } catch {
    // Reportar un error nunca puede romper la app.
  }
}

let temporizador = null;
let enviando = false;

function programarEnvio() {
  if (temporizador) return;
  temporizador = setTimeout(() => { temporizador = null; enviarPendientes(); }, ESPERA_ENVIO_MS);
}

/** Lo que va al backend: sin los campos internos de la cola. */
function paraEnviar(x) {
  const { usuario_id: _u, id: _id, veces, ...resto } = x;
  return veces > 1 ? { ...resto, mensaje: `${resto.mensaje} (×${veces})` } : resto;
}

/**
 * Manda la cola en lotes. Sin sesión no hace nada (el endpoint la pide); si
 * falla, la cola se queda para la próxima.
 */
export async function enviarPendientes() {
  if (enviando || !getItem('accessToken')) return;
  enviando = true;
  try {
    const yo = usuarioActualId();
    // Los de otro usuario se tiran: no hay forma honrada de atribuírselos.
    let cola = leerCola().filter((x) => x.usuario_id == null || x.usuario_id === yo);
    guardarCola(cola);

    while (cola.length) {
      const lote = cola.slice(0, LOTE_MAX);
      await api.post('/errores-cliente', { errores: lote.map(paraEnviar) }, { _sinReporteDeError: true });
      // Se relee: mientras viajaba el lote han podido entrar errores nuevos.
      const enviados = new Set(lote.map((x) => x.id));
      cola = leerCola().filter((x) => !enviados.has(x.id));
      guardarCola(cola);
    }
  } catch {
    // Sin red, 401 o 429: se reintenta con el siguiente error, al volver la
    // red o al volver a la pestaña.
  } finally {
    enviando = false;
  }
}

/**
 * Decide si un error de axios se reporta y lo apunta. Lo llama el
 * interceptor de respuesta de api.js justo antes de rechazar.
 */
export function reportarErrorDePeticion(error) {
  const config = error?.config;
  if (!config || config._sinReporteDeError) return;
  if (error.code === 'ERR_CANCELED') return;

  const metodo = (config.method || 'get').toUpperCase();
  const url = sinQuery(config.url);
  const status = error.response?.status;

  if (!error.response) {
    if (metodo === 'GET') return;
    const esTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
    const sinConexion = typeof navigator !== 'undefined' && navigator.onLine === false;
    registrarError({
      tipo:    esTimeout ? 'timeout' : 'red',
      mensaje: `${error.message || 'Sin respuesta'}${sinConexion ? ' (el dispositivo dice que no tiene conexión)' : ''}`,
      metodo, url,
    });
    return;
  }
  if (status === 502 || status === 503 || status === 504) {
    registrarError({ tipo: 'http', mensaje: `HTTP ${status} (no llegó al backend)`, metodo, url, status });
  }
}

let instalado = false;

/** Engancha los errores globales de JS y los disparadores de envío. Una vez. */
export function instalarReporteDeErrores() {
  if (instalado || typeof window === 'undefined') return;
  instalado = true;

  window.addEventListener('error', (ev) => {
    // «Script error.» es un script de otro origen (extensión, traductor):
    // sin mensaje ni pila no sirve de nada.
    if (!ev.message || ev.message === 'Script error.') return;
    if (ev.message.includes('ResizeObserver loop')) return;   // aviso benigno del navegador
    registrarError({
      tipo:    'js',
      mensaje: ev.message,
      stack:   ev.error?.stack || (ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : null),
    });
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    if (r?.isAxiosError) return;   // ya pasó por reportarErrorDePeticion
    registrarError({
      tipo:    'promesa',
      mensaje: r?.message || String(r),
      stack:   r?.stack || null,
    });
  });

  window.addEventListener('online', () => enviarPendientes());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') enviarPendientes();
  });
  // Lo que quedó de la última vez que se abrió la app.
  setTimeout(() => enviarPendientes(), ESPERA_ENVIO_MS);
}

/** Solo para tests. */
export function _reiniciar() {
  clearTimeout(temporizador);
  temporizador = null;
  enviando = false;
  instalado = false;
  vistosRecientes.clear();
}
