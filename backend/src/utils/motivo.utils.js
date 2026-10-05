/**
 * utils/motivo.utils.js
 * Regla del motivo de fin anticipado (asignaciones y trabajos). Espejo en
 * frontend/src/utils/motivo.js: si cambia uno, cambia el otro.
 */

'use strict';

const MOTIVO_MIN_CARACTERES = 5;
const MOTIVO_NO_VALIDO = 'Escribe un motivo válido';

// Devuelve el texto del error, o null si el motivo vale. Se mide ya recortado,
// así que solo espacios no cuenta. «Mismo carácter repetido» se mira sin
// espacios y sin distinguir mayúsculas: «aaaaa», «a a a a a» o «AaAaA» no
// explican nada y pasaban como motivo. Ese caso da un mensaje genérico A
// PROPÓSITO (decisión del usuario, 2026-10-05): no se da pista de la regla,
// solo se avisa abiertamente del mínimo de caracteres.
function errorMotivo(motivo) {
  const texto = typeof motivo === 'string' ? motivo.trim() : '';
  if (texto.length < MOTIVO_MIN_CARACTERES) {
    return `El motivo debe tener al menos ${MOTIVO_MIN_CARACTERES} caracteres`;
  }
  if (new Set(texto.replace(/\s+/g, '').toLowerCase()).size < 2) {
    return MOTIVO_NO_VALIDO;
  }
  return null;
}

module.exports = { MOTIVO_MIN_CARACTERES, errorMotivo };
