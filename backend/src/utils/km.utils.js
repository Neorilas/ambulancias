/**
 * utils/km.utils.js
 * Espejo de frontend/src/utils/kmUtils.js (parseKm): mismo criterio para
 * distinguir el "." de miles («45.000») de un decimal mal tecleado
 * («4.5»), pero aquí como `customSanitizer` de express-validator — solo
 * limpia la cadena, la validación de que sea un entero la sigue haciendo
 * `isInt()` después.
 */

'use strict';

const RE_MILES = /^\d{1,3}(\.\d{3})+$/;

/** Quita el "." solo cuando el patrón es exactamente el de miles en español. */
function limpiarMilesKm(valor) {
  if (typeof valor !== 'string') return valor;
  const raw = valor.trim();
  return RE_MILES.test(raw) ? raw.replace(/\./g, '') : raw;
}

module.exports = { limpiarMilesKm };
