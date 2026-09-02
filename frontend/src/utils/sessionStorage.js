/**
 * utils/sessionStorage.js
 * Acceso a localStorage con las claves separadas por entorno.
 *
 * PRE y PRODUCCIÓN se sirven desde el mismo origen (https://vapss.net, en
 * /app-pre/ y /app/), así que comparten localStorage. Con las claves sueltas
 * —'accessToken', 'user'…— entrar en PRE pisaba la sesión de PRODUCCIÓN y al
 * volver a la app buena el token no valía (los secretos JWT son distintos):
 * el técnico se encontraba deslogueado sin haber tocado nada.
 *
 * Con el prefijo, cada entorno tiene su sesión y conviven sin enterarse.
 */

const APP_ENV = import.meta.env.VITE_APP_ENV || 'produccion';

/** Prefijo de las claves de este entorno. Producción lo lleva también, para
 *  que no haya un caso especial que luego se olvide. */
export const PREFIJO = `vapss:${APP_ENV}:`;

/**
 * Rescata la sesión guardada con el formato antiguo (claves sin prefijo).
 *
 * Hasta ahora producción escribía 'accessToken' a secas. Sin esto, el primer
 * despliegue con claves prefijadas dejaría fuera a todos los técnicos que ya
 * tenían sesión abierta. Solo lo hace PRODUCCIÓN: si lo hiciera PRE, se
 * quedaría con un token que sus secretos JWT no saben validar.
 */
function migrarClavesAntiguas() {
  if (APP_ENV !== 'produccion') return;
  try {
    ['accessToken', 'refreshToken', 'user'].forEach(clave => {
      const antiguo = localStorage.getItem(clave);
      if (antiguo !== null && localStorage.getItem(PREFIJO + clave) === null) {
        localStorage.setItem(PREFIJO + clave, antiguo);
      }
      if (antiguo !== null) localStorage.removeItem(clave);
    });
  } catch { /* ignorado */ }
}

migrarClavesAntiguas();

export function getItem(clave) {
  try { return localStorage.getItem(PREFIJO + clave); }
  catch { return null; }
}

export function setItem(clave, valor) {
  try { localStorage.setItem(PREFIJO + clave, valor); }
  catch { /* modo privado o cuota llena: la app sigue, sin persistir */ }
}

export function removeItem(clave) {
  try { localStorage.removeItem(PREFIJO + clave); }
  catch { /* ignorado */ }
}

/**
 * Borra solo las claves de ESTE entorno.
 * Sustituye a localStorage.clear(), que se llevaba por delante la sesión del
 * otro entorno y las preferencias no relacionadas con la app.
 */
export function clear() {
  try {
    const suyas = Object.keys(localStorage).filter(k => k.startsWith(PREFIJO));
    suyas.forEach(k => localStorage.removeItem(k));
  } catch { /* ignorado */ }
}
