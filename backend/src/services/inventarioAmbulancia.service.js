/**
 * services/inventarioAmbulancia.service.js
 * Lo que lleva dentro cada ambulancia (v46, MAPA_CODIGO.md §2.10
 * «Inventario de las ambulancias»).
 *
 * Lo comparten dos caminos, y solo esos dos mueven el inventario:
 *  - el alta a mano de un administrador (inventario.controller), y
 *  - una salida del almacén a esa ambulancia (almacen.controller,
 *    createMovimiento con `salida_ambulancia`), en la MISMA transacción que
 *    la salida.
 * Nada más lo toca: ni el material gastado al cerrar una asignación, ni las
 * devoluciones, ni las salidas a otros destinos (decisión del usuario,
 * 2026-11-19: «de momento solo en ese caso»).
 */

'use strict';

/**
 * Bloquea la ambulancia viva hasta el fin de la transacción y la devuelve, o
 * null si no existe o está de baja. Es el candado del inventario: la tabla no
 * tiene UNIQUE (con caducidad NULL MySQL no lo haría cumplir), así que dos
 * altas a la vez del mismo producto con la misma caducidad solo se funden en
 * una línea si pasan de una en una.
 */
async function bloquearAmbulancia(conn, vehicleId) {
  const [filas] = await conn.query(
    'SELECT id, alias, matricula FROM vehicles WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
    [vehicleId]
  );
  return filas[0] || null;
}

/**
 * La línea del inventario que es «lo mismo»: mismo producto del catálogo (o
 * mismo texto libre, sin distinguir mayúsculas ni tildes por la colación) y
 * misma caducidad. `excepto` deja fuera una línea (al editarla).
 */
async function lineaIgual(conn, { vehicleId, productoId, nombre, caducidad }, excepto = null) {
  const where = ['vehicle_id = ?'];
  const params = [vehicleId];
  if (productoId) { where.push('producto_id = ?'); params.push(productoId); }
  else { where.push('producto_id IS NULL AND nombre = ?'); params.push(nombre); }
  if (caducidad) { where.push('caducidad = ?'); params.push(caducidad); }
  else where.push('caducidad IS NULL');
  if (excepto) { where.push('id <> ?'); params.push(excepto); }
  const [filas] = await conn.query(
    `SELECT id, cantidad FROM vehiculo_inventario WHERE ${where.join(' AND ')} ORDER BY id LIMIT 1`,
    params
  );
  return filas[0] || null;
}

/**
 * Suma `cantidad` al inventario de la ambulancia: a la línea igual si ya la
 * hay, o crea una. La ambulancia tiene que estar ya bloqueada
 * (`bloquearAmbulancia`) en esta misma transacción.
 *
 * @returns {Promise<{ id: number, sumado: boolean, cantidad: number }>}
 *   `sumado` = había ya una línea igual; `cantidad` = lo que queda en ella.
 */
async function sumarAlInventario(conn, { vehicleId, productoId = null, nombre = null, caducidad = null, cantidad, notas = null, userId, t }) {
  const igual = await lineaIgual(conn, { vehicleId, productoId, nombre, caducidad });
  if (igual) {
    // Las notas nuevas sustituyen a las viejas solo si vienen
    await conn.query(
      `UPDATE vehiculo_inventario SET cantidad = cantidad + ?, ${notas ? 'notas = ?, ' : ''}updated_at = ? WHERE id = ?`,
      notas ? [cantidad, notas, t, igual.id] : [cantidad, t, igual.id]
    );
    return { id: igual.id, sumado: true, cantidad: Number(igual.cantidad) + cantidad };
  }
  const [r] = await conn.query(
    `INSERT INTO vehiculo_inventario
       (vehicle_id, producto_id, nombre, caducidad, cantidad, notas, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [vehicleId, productoId, productoId ? null : nombre, caducidad, cantidad, notas, userId, t, t]
  );
  return { id: r.insertId, sumado: false, cantidad };
}

module.exports = { bloquearAmbulancia, lineaIgual, sumarAlInventario };
