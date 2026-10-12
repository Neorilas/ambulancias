/**
 * utils/kmUtils.js
 * Kilómetros son un entero: sin decimales, sin separador de miles en BD.
 */

// El "." se usa en español como separador de miles («45.000», «1.234.567»):
// se quita solo cuando el patrón es exactamente ese (grupos de tres dígitos
// tras cada punto), para no confundirlo con un decimal mal tecleado
// («4.5», «45.00»), que debe seguir sin ser un km válido en vez de colarse
// como otro número distinto. No afecta a cómo se muestra después (eso lo
// hace `toLocaleString()`).
const RE_MILES = /^\d{1,3}(\.\d{3})+$/;

export function parseKm(value) {
  if (value === '' || value === null || value === undefined) return null;
  const raw = String(value).trim();
  const limpio = RE_MILES.test(raw) ? raw.replace(/\./g, '') : raw;
  const n = Number(limpio);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// «5.650 km» y no «5650 km»: en es-ES, `toLocaleString` no agrupa los números
// de cuatro cifras (regla de la CLDR), y junto a un «90.000 km» parecía otro
// formato. Se agrupa a mano, igual en todos los navegadores.
export function formatKm(n) {
  const entero = Math.trunc(Number(n));
  if (!Number.isFinite(entero)) return '';
  const signo = entero < 0 ? '-' : '';
  return `${signo}${String(Math.abs(entero)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} km`;
}
