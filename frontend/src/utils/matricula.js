/**
 * utils/matricula.js
 * Espejo de backend/src/utils/matricula.utils.js: mismas reglas, para poder
 * avisar en el propio formulario antes de llamar a la API.
 *
 * Formatos aceptados (España):
 *   - Actual (desde 2000): 1234 BCD   — 4 dígitos + 3 consonantes
 *   - Anterior:            M 1234 AB  — 1-2 letras de provincia + 4 dígitos + 0-2 letras
 * Los separadores son opcionales y se descartan al normalizar.
 */

const RE_ACTUAL  = /^[0-9]{4}[BCDFGHJKLMNPRSTVWXYZ]{3}$/;
const RE_ANTIGUA = /^[A-Z]{1,2}[0-9]{4}[A-Z]{0,2}$/;

/** Forma canónica: sin separadores ni espacios, en mayúsculas. */
export function normalizarMatricula(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).toUpperCase().replace(/[\s.\-_]/g, '');
}

/** ¿El texto tiene forma de matrícula española (actual o antigua)? */
export function esMatricula(valor) {
  const m = normalizarMatricula(valor);
  return RE_ACTUAL.test(m) || RE_ANTIGUA.test(m);
}

export const MENSAJE_FORMATO =
  'Formato no válido. Se espera 1234BCD o M1234AB. ' +
  'El nombre de la ambulancia va en el campo de arriba.';
