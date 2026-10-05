/**
 * utils/motivo.js
 * Regla del motivo de fin anticipado. Espejo de backend
 * src/utils/motivo.utils.js: si cambia uno, cambia el otro.
 */

export const MOTIVO_MIN_CARACTERES = 5;

// Texto del error, o null si el motivo vale. Recortado (solo espacios no
// cuenta) y sin aceptar un mismo carácter repetido («aaaaa», «a a a a a»).
export function errorMotivo(motivo) {
  const texto = typeof motivo === 'string' ? motivo.trim() : '';
  if (texto.length < MOTIVO_MIN_CARACTERES) {
    return `El motivo debe tener al menos ${MOTIVO_MIN_CARACTERES} caracteres`;
  }
  if (new Set(texto.replace(/\s+/g, '').toLowerCase()).size < 2) {
    return 'El motivo no puede ser un mismo carácter repetido';
  }
  return null;
}
