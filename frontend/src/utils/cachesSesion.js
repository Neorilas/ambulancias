/**
 * utils/cachesSesion.js
 * Vacía las cachés del service worker que guardan datos de la sesión.
 *
 * Workbox indexa por URL, no por usuario: sin esto, en un dispositivo
 * compartido el siguiente en entrar podía recibir (con mala red o sin ella)
 * la respuesta cacheada de quien acababa de cerrar sesión. Los nombres son
 * los `cacheName` de `sw.js`; si se añade una caché con datos de la API o
 * fotos, va también aquí.
 */

export const CACHES_DE_SESION = ['api-cache', 'images-cache'];

export async function vaciarCachesDeSesion() {
  try {
    if (typeof caches === 'undefined') return;
    await Promise.all(CACHES_DE_SESION.map((nombre) => caches.delete(nombre)));
  } catch {
    // Sin Cache Storage (navegación privada, contexto no seguro): nada que vaciar.
  }
}
