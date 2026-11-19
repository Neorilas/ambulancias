/**
 * Inventario de las ambulancias (v46, MAPA_CODIGO.md §2.10). Lógica pura de
 * `components/inventario/InventarioAmbulancia.jsx`.
 */

import { normalizar } from './materialGastado.js';
import { estadoCaducidad } from './almacen.js';

export const MAX_CANTIDAD = 100000;

/**
 * El producto del catálogo que se llama exactamente así (sin mirar mayúsculas
 * ni tildes), o null. Quien escribe «guedel 3» entero sin pinchar la
 * sugerencia está nombrando ese producto, no un texto libre que se le parece.
 */
export function productoExacto(catalogo, texto) {
  const n = normalizar(String(texto ?? '').trim().replace(/\s+/g, ' '));
  if (!n) return null;
  return (catalogo || []).find(p => normalizar(p.nombre) === n) || null;
}

/** Las líneas cuyo nombre tiene todas las palabras buscadas. */
export function filtrarLineas(lineas, q) {
  const palabras = normalizar(q).split(/\s+/).filter(Boolean);
  if (!palabras.length) return lineas;
  return lineas.filter(l => {
    const n = normalizar(l.nombre);
    return palabras.every(w => n.includes(w));
  });
}

/**
 * Cuántas líneas avisan: caducadas o que caducan pronto (solo si queda algo:
 * lo que está a 0 ya no caduca) y agotadas.
 */
export function avisosInventario(lineas, hoy) {
  const r = { caducado: 0, pronto: 0, agotado: 0 };
  for (const l of lineas) {
    if (l.cantidad <= 0) { r.agotado += 1; continue; }
    const e = estadoCaducidad(l.caducidad, hoy);
    if (e === 'caducado' || e === 'pronto') r[e] += 1;
  }
  return r;
}

/** Cantidad escrita en el campo: entero entre `min` y MAX_CANTIDAD, o null. */
export function cantidadEscrita(t, min = 1) {
  const s = String(t ?? '').trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= MAX_CANTIDAD ? n : null;
}

/** «UVI-03 · 1234ABC» o la matrícula sola. */
export const nombreAmbulancia = (a) => (a?.alias ? `${a.alias} · ${a.matricula}` : a?.matricula || '');
