/**
 * Material gastado en el cierre de una asignación (v45, MAPA_CODIGO.md §2.10
 * «Consumo en el cierre»). Lógica pura de `MaterialGastado.jsx`.
 *
 * A propósito NO importa nada de `utils/almacen.js`: este paso va en el
 * bundle que ve todo el mundo y el almacén es un chunk aparte, solo para
 * administración (`Almacen-*.js` en `globIgnores`).
 */

export const SIN_GASTO = 'Sin gasto de material';
export const MAX_SUGERENCIAS = 5;
export const MIN_LETRAS = 2;
export const MAX_CANTIDAD = 999;

/** Minúsculas y sin tildes: «suero» encuentra «Suéro» y «laríngea» con «laringea». */
export function normalizar(t) {
  return String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Hasta MAX_SUGERENCIAS productos del catálogo que tengan todas las palabras
 * buscadas, sin los ya elegidos. Primero los que empiezan por lo buscado.
 */
export function buscarProductos(catalogo, q, elegidos = []) {
  const palabras = normalizar(q).split(/\s+/).filter(Boolean);
  if (palabras.join('').length < MIN_LETRAS) return [];
  const yaElegidos = new Set(elegidos.map(i => i.producto_id));
  const primera = palabras[0];
  return (catalogo || [])
    .filter(p => !yaElegidos.has(p.id))
    .map(p => ({ p, n: normalizar(p.nombre) }))
    .filter(({ n }) => palabras.every(w => n.includes(w)))
    .sort((a, b) => (b.n.startsWith(primera) - a.n.startsWith(primera)) || a.n.localeCompare(b.n))
    .slice(0, MAX_SUGERENCIAS)
    .map(({ p }) => p);
}

/** «Caja», «Ampolla»… La presentación solo cuando dice algo («Unidad» no). */
export function presentacionVisible(p) {
  const pres = String(p?.presentacion ?? '').trim();
  return pres && pres.toLowerCase() !== 'unidad' ? pres : '';
}

/** El texto que se guardará, igual que lo monta el backend (materialGastado.service). */
export function textoMaterial({ gasto, items, libre }) {
  if (gasto === 'no') return SIN_GASTO;
  if (gasto !== 'si') return '';
  const lineas = items.map(i => {
    const pres = presentacionVisible(i);
    return `${i.cantidad} × ${i.nombre}${pres ? ` (${pres})` : ''}`;
  });
  if (libre.trim()) lineas.push(libre.trim());
  return lineas.join('\n');
}

/** Se puede seguir: «No», o «Sí» con algún producto o algo escrito. */
export function materialCompleto(m) {
  return m.gasto === 'no' || (m.gasto === 'si' && (m.items.length > 0 || !!m.libre.trim()));
}

/** Lo que va a /finalizar. Con «No», el texto de siempre y ningún producto. */
export function cuerpoMaterial(m) {
  if (m.gasto === 'no') return { material_usado: SIN_GASTO };
  return {
    material_usado: m.libre.trim(),
    material_items: m.items.map(i => ({ producto_id: i.producto_id, cantidad: i.cantidad })),
  };
}

export const MATERIAL_VACIO = { gasto: null, items: [], libre: '', verLibre: false };
