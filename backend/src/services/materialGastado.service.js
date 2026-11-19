/**
 * services/materialGastado.service.js
 * Material gastado al cerrar una asignación, elegido del catálogo del almacén
 * (v45, MAPA_CODIGO.md §2.10 «Consumo en el cierre»).
 *
 * El técnico elige productos del almacén con su cantidad y, si no encuentra
 * alguno, lo escribe a mano. Se guardan las dos cosas:
 *   - cada producto con su cantidad en `asignacion_material`, enlazado a la
 *     asignación y al producto: es lo que servirá cuando las ambulancias
 *     tengan inventario y el consumo reste de su dotación;
 *   - el texto `material_usado` de siempre, montado aquí con los nombres del
 *     catálogo (una línea por producto) más lo escrito a mano. Así la ficha
 *     de la asignación, el historial del vehículo y la auditoría lo siguen
 *     enseñando sin cambiar nada.
 *
 * NO toca el stock del almacén (decisión del usuario, 2026-11-19): ese
 * material ya salió del almacén cuando se cargó la ambulancia; restarlo otra
 * vez lo contaría dos veces.
 */

'use strict';

const { query } = require('../config/database');

const MAX_PRODUCTOS = 50;
const MAX_CANTIDAD  = 999;

/**
 * Valida y agrupa lo que manda el cliente. Un producto repetido se suma (dos
 * toques al mismo producto desde dos búsquedas no son dos filas).
 * @returns {{ items: {producto_id:number, cantidad:number}[] } | { error: string }}
 */
function normalizarItems(raw) {
  if (raw == null) return { items: [] };
  if (!Array.isArray(raw)) return { error: 'material_items tiene que ser una lista' };
  if (raw.length > MAX_PRODUCTOS) return { error: `Como mucho ${MAX_PRODUCTOS} productos distintos` };
  const porProducto = new Map();
  for (const it of raw) {
    const id = Number(it?.producto_id);
    const cantidad = Number(it?.cantidad);
    if (!Number.isInteger(id) || id < 1) return { error: 'Producto no válido en el material gastado' };
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD) {
      return { error: `La cantidad de cada producto tiene que ir de 1 a ${MAX_CANTIDAD}` };
    }
    porProducto.set(id, (porProducto.get(id) || 0) + cantidad);
  }
  const items = [...porProducto].map(([producto_id, cantidad]) => ({
    producto_id, cantidad: Math.min(cantidad, MAX_CANTIDAD),
  }));
  return { items };
}

/** Nombre y presentación de los productos elegidos (activos o no: pudo retirarse mientras cerraba). */
async function cargarProductos(ids) {
  if (!ids.length) return new Map();
  const [rows] = await query(
    `SELECT id, nombre, presentacion FROM material_productos WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  return new Map(rows.map(r => [r.id, r]));
}

/** «2 × Guantes (Caja)»: la presentación solo si dice algo («Unidad» no). */
function lineaProducto(p, cantidad) {
  const pres = (p.presentacion || '').trim();
  const sufijo = pres && pres.toLowerCase() !== 'unidad' ? ` (${pres})` : '';
  return `${cantidad} × ${p.nombre}${sufijo}`;
}

/** El texto `material_usado`: una línea por producto y, debajo, lo escrito a mano. */
function textoMaterial(items, productos, libre) {
  const lineas = items.map(it => lineaProducto(productos.get(it.producto_id), it.cantidad));
  if (libre) lineas.push(libre);
  return lineas.join('\n');
}

/** Catálogo para el buscador del cierre: solo id, nombre y presentación de los activos. */
async function catalogo() {
  const [rows] = await query(
    `SELECT id, nombre, presentacion FROM material_productos WHERE activo = 1 ORDER BY nombre`
  );
  return rows;
}

module.exports = { normalizarItems, cargarProductos, textoMaterial, lineaProducto, catalogo, MAX_PRODUCTOS, MAX_CANTIDAD };
