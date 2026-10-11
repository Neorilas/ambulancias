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

// Hosts por NOMBRE, no por forma: una regex como `google\.[a-z]{2,3}…`
// dejaba pasar `maps.google.abc.me` o `google.cc`, dominios que registra
// cualquiera (revisión del 2026-10-11). Si hace falta otro país, se añade aquí.
const HOSTS_MAPS   = new Set(['maps.app.goo.gl', 'maps.google.com', 'maps.google.es']);
const HOSTS_GOOGLE = new Set(['google.com', 'www.google.com', 'google.es', 'www.google.es']);
const esRutaMaps   = (ruta) => ruta === '/maps' || ruta.startsWith('/maps/');

/**
 * ¿Es un enlace de Google Maps que se pueda abrir sin peligro?
 * `https`, sin usuario ni puerto, y de uno de estos sitios:
 *   - maps.app.goo.gl/…      (el de «Compartir» de la app y la web)
 *   - goo.gl/maps/…          (el corto de antes)
 *   - maps.google.com|es/…
 *   - [www.]google.com|es/maps…
 */
function esEnlaceGoogleMaps(texto) {
  if (typeof texto !== 'string') return false;
  const t = texto.trim();
  if (!t || t.length > MAX_ENLACE_MAPS) return false;
  let u;
  try { u = new URL(t); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;

  const host = u.hostname.toLowerCase();
  if (HOSTS_MAPS.has(host)) return true;
  if (host === 'goo.gl' || HOSTS_GOOGLE.has(host)) return esRutaMaps(u.pathname);
  return false;
}

module.exports = { esEnlaceGoogleMaps, MAX_ENLACE_MAPS };
