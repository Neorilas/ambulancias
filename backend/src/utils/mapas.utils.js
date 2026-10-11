/**
 * utils/mapas.utils.js
 *
 * El enlace de Google Maps de un trabajo (v34). Lo pega quien crea el trabajo
 * y acaba como botón en el móvil de toda la gente que va en él: por eso solo
 * se aceptan enlaces de Google Maps y no cualquier URL, que convertiría el
 * campo en una forma de repartir enlaces a quien sea.
 *
 * La misma regla está en frontend/src/utils/mapas.js: si se cambia aquí, allí.
 */

'use strict';

const MAX_ENLACE_MAPS = 500;

// google.com, google.es, google.co.uk, google.com.mx…
const DOMINIO_GOOGLE = /^(www\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/;
const DOMINIO_MAPS   = /^maps\.google\.[a-z]{2,3}(\.[a-z]{2})?$/;

/**
 * ¿Es un enlace de Google Maps que se pueda abrir sin peligro?
 * `https`, sin usuario ni puerto, y de uno de estos sitios:
 *   - maps.app.goo.gl/…      (el de «Compartir» de la app y la web)
 *   - goo.gl/maps/…          (el corto de antes)
 *   - maps.google.<tld>/…
 *   - [www.]google.<tld>/maps…
 */
function esEnlaceGoogleMaps(texto) {
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

module.exports = { esEnlaceGoogleMaps, MAX_ENLACE_MAPS };
