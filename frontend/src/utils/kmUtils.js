/**
 * utils/kmUtils.js
 * Kilómetros son un entero: sin decimales, sin separador de miles en BD.
 */

// El "." se usa a veces como separador de miles en español («45.000») y a
// veces se cuela como decimal. Da igual el motivo: se quita SIEMPRE antes de
// parsear, porque `parseInt("45.000")` corta en el punto y da 45, no 45000.
// No afecta a cómo se muestra después (eso lo hace `toLocaleString()`).
export function parseKm(value) {
  if (value === '' || value === null || value === undefined) return null;
  const limpio = String(value).replace(/\./g, '');
  if (limpio === '' || limpio === '-') return null;
  const n = parseInt(limpio, 10);
  return Number.isNaN(n) ? null : n;
}
