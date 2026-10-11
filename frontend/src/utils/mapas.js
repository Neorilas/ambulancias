/**
 * utils/mapas.js
 * La ubicación del trabajo en Google Maps (v34).
 *
 * Dos formas de llegar al mapa:
 *   - `ubicacion_url`: el enlace que pega quien crea el trabajo desde
 *     «Compartir» de Google Maps. Es el punto exacto.
 *   - sin enlace, una búsqueda en Maps con el texto de `ubicacion`. Puede no
 *     llevar al sitio exacto («Retiro, puerta 3»), y por eso el formulario
 *     avisa de revisarla y el botón dice «Buscar», no «Abrir».
 *
 * `esEnlaceGoogleMaps` es la misma regla que backend/src/utils/mapas.utils.js,
 * que es quien manda: si se cambia allí, aquí.
 */

export const MAX_ENLACE_MAPS = 500;

const DOMINIO_GOOGLE = /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/;
const DOMINIO_MAPS   = /^maps\.google\.[a-z]{2,3}(\.[a-z]{2})?$/;

/** ¿Es un enlace de Google Maps (https, de sus dominios)? */
export function esEnlaceGoogleMaps(texto) {
  if (typeof texto !== 'string') return false;
  const t = texto.trim();
  if (!t || t.length > MAX_ENLACE_MAPS) return false;
  let u;
  try { u = new URL(t); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;

  const host = u.hostname.toLowerCase();
  if (host === 'maps.app.goo.gl') return true;
  if (host === 'goo.gl') return u.pathname.startsWith('/maps');
  if (DOMINIO_MAPS.test(host)) return true;
  if (DOMINIO_GOOGLE.test(host)) return u.pathname === '/maps' || u.pathname.startsWith('/maps/');
  return false;
}

/** Búsqueda de un texto en Google Maps (URL universal: abre la app si está). */
export function enlaceBusquedaMaps(texto) {
  const t = (texto || '').trim();
  return t ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t)}` : null;
}

/**
 * Adónde lleva el botón de Maps de un trabajo: `{ url, exacto }`, o null si
 * no hay ni enlace ni texto. Un enlace guardado que no pase la regla (no
 * debería: el backend lo valida) no se ofrece, y se cae a la búsqueda.
 */
export function mapsDeTrabajo(trabajo) {
  if (!trabajo) return null;
  if (esEnlaceGoogleMaps(trabajo.ubicacion_url)) {
    return { url: trabajo.ubicacion_url.trim(), exacto: true };
  }
  const url = enlaceBusquedaMaps(trabajo.ubicacion);
  return url ? { url, exacto: false } : null;
}
