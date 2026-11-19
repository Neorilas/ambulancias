/**
 * controllers/inventario.controller.js
 * Inventario de cada ambulancia (v46, MAPA_CODIGO.md §2.10 «Inventario de
 * las ambulancias»).
 *
 * Quién (inventario.routes.js): lo VEN administradores, gestores y
 * superadmin; para el resto no existe (404, como el almacén). Lo CAMBIAN solo
 * administradores y superadmin: el usuario pidió que «los administradores
 * pueden crear elementos»; el gestor mira.
 *
 * Arranca vacío. Lo mueven dos cosas y nada más: lo que se escribe aquí y
 * una salida del almacén a esa ambulancia (almacen.controller →
 * services/inventarioAmbulancia.service.js).
 */

'use strict';

const { query, transaction } = require('../config/database');
const { success, created, error, notFound } = require('../utils/response.utils');
const { ahora } = require('../utils/fecha.utils');
const {
  texto, idOpcional, entero, caducidadValida, auditar, MAX, MAX_CANTIDAD,
} = require('./almacen.controller');
const { bloquearAmbulancia, lineaIgual, sumarAlInventario } = require('../services/inventarioAmbulancia.service');

// Una línea del inventario como la pinta la pantalla. El nombre y la
// presentación salen del catálogo si es un producto del almacén (así un
// cambio de nombre en el catálogo llega solo); si no, del texto libre.
// DATE_FORMAT: un DATE leído con la sesión en UTC llegaría como Date a
// medianoche y el navegador lo pintaría el día anterior.
const COLUMNAS_LINEA = `i.id, i.vehicle_id, i.producto_id, COALESCE(p.nombre, i.nombre) AS nombre,
  p.presentacion, p.tipo, DATE_FORMAT(i.caducidad, '%Y-%m-%d') AS caducidad, i.cantidad, i.notas,
  i.updated_at`;
const DESDE_LINEA = `FROM vehiculo_inventario i LEFT JOIN material_productos p ON p.id = i.producto_id`;

function filaLinea(l) {
  return { ...l, cantidad: Number(l.cantidad), del_almacen: l.producto_id !== null };
}

async function leerLinea(id, conn = null) {
  const q = conn ? conn.query.bind(conn) : query;
  const [filas] = await q(`SELECT ${COLUMNAS_LINEA} ${DESDE_LINEA} WHERE i.id = ?`, [id]);
  return filas[0] ? filaLinea(filas[0]) : null;
}

const nombreAmbulancia = (v) => v.alias || v.matricula;

/**
 * GET /inventario/ambulancias — las ambulancias vivas con un resumen de su
 * inventario, para elegir una (vista «Ambulancias» del almacén).
 * `proxima_caducidad` = la más próxima de lo que queda (cantidad > 0).
 */
async function listAmbulancias(req, res, next) {
  try {
    const [filas] = await query(
      `SELECT v.id, v.alias, v.matricula,
              COUNT(i.id) AS lineas,
              COALESCE(SUM(i.cantidad), 0) AS unidades,
              DATE_FORMAT(MIN(CASE WHEN i.cantidad > 0 THEN i.caducidad END), '%Y-%m-%d') AS proxima_caducidad
         FROM vehicles v
         LEFT JOIN vehiculo_inventario i ON i.vehicle_id = v.id
        WHERE v.deleted_at IS NULL
        GROUP BY v.id, v.alias, v.matricula
        ORDER BY COALESCE(v.alias, v.matricula)`
    );
    return success(res, filas.map(f => ({ ...f, lineas: Number(f.lineas), unidades: Number(f.unidades) })));
  } catch (err) {
    next(err);
  }
}

/** GET /inventario/ambulancias/:id — la ambulancia y todo lo que lleva. */
async function getAmbulancia(req, res, next) {
  try {
    const id = idOpcional(req.params.id);
    if (!id) return notFound(res, 'Vehículo');
    const [vehiculos] = await query(
      'SELECT id, alias, matricula FROM vehicles WHERE id = ? AND deleted_at IS NULL',
      [id]
    );
    if (!vehiculos[0]) return notFound(res, 'Vehículo');
    const [lineas] = await query(
      `SELECT ${COLUMNAS_LINEA} ${DESDE_LINEA}
        WHERE i.vehicle_id = ?
        ORDER BY COALESCE(p.nombre, i.nombre), i.caducidad IS NULL, i.caducidad, i.id`,
      [id]
    );
    return success(res, { vehiculo: vehiculos[0], lineas: lineas.map(filaLinea) });
  } catch (err) {
    next(err);
  }
}

/** Valida caducidad y notas comunes al alta y a la edición. */
function leerCaducidadYNotas(b) {
  const caducidad = caducidadValida(b.caducidad);
  if (caducidad === undefined) return { fallo: 'Caducidad no válida' };
  const notas = texto(b.notas);
  if (notas && notas.length > MAX.notas) return { fallo: `Las notas no pueden pasar de ${MAX.notas} caracteres` };
  return { caducidad, notas };
}

/**
 * POST /inventario/ambulancias/:id/lineas
 *   { producto_id } o { nombre } (texto libre, si no está en el almacén),
 *   cantidad (1..MAX), caducidad? (vacía = no caduca), notas?
 * Si ya hay una línea con lo mismo y la misma caducidad, se suma a ella.
 * NO toca el almacén: es apuntar lo que ya hay dentro de la ambulancia.
 */
async function createLinea(req, res, next) {
  try {
    const vehicleId = idOpcional(req.params.id);
    if (!vehicleId) return notFound(res, 'Vehículo');
    const b = req.body || {};
    const productoId = idOpcional(b.producto_id);
    if (Number.isNaN(productoId)) return error(res, 'Producto no válido', 400);
    const nombre = productoId ? null : texto(b.nombre);
    if (!productoId && !nombre) return error(res, 'Di qué es: un producto del almacén o un nombre', 400);
    if (nombre && nombre.length > MAX.nombre) return error(res, `El nombre no puede pasar de ${MAX.nombre} caracteres`, 400);
    const cantidad = entero(b.cantidad, 1, MAX_CANTIDAD);
    if (Number.isNaN(cantidad)) return error(res, `La cantidad tiene que ser un número entero entre 1 y ${MAX_CANTIDAD}`, 400);
    const { caducidad, notas, fallo } = leerCaducidadYNotas(b);
    if (fallo) return error(res, fallo, 400);

    const t = ahora();
    const r = await transaction(async (conn) => {
      const vehiculo = await bloquearAmbulancia(conn, vehicleId);
      if (!vehiculo) return { status: 404, mensaje: 'Vehículo no encontrado' };
      let producto = null;
      if (productoId) {
        const [ps] = await conn.query('SELECT id, nombre, activo FROM material_productos WHERE id = ?', [productoId]);
        producto = ps[0];
        if (!producto) return { status: 422, mensaje: 'Ese producto no está en el almacén' };
        if (!producto.activo) return { status: 409, mensaje: 'Ese producto está retirado del catálogo del almacén' };
      }
      const suma = await sumarAlInventario(conn, {
        vehicleId, productoId, nombre, caducidad, cantidad, notas, userId: req.user.id, t,
      });
      return { ...suma, vehiculo, producto };
    });
    if (r.status) return error(res, r.mensaje, r.status);

    await auditar(req, 'create_inventario_ambulancia', 'vehiculo_inventario', r.id, {
      vehiculo: nombreAmbulancia(r.vehiculo),
      vehicle_id: vehicleId,
      elemento: r.producto ? r.producto.nombre : nombre,
      ...(r.producto && { producto_id: productoId }),
      caducidad,
      cantidad,
      ...(r.sumado && { sumado: true, queda: r.cantidad }),
    });
    return created(res, await leerLinea(r.id), r.sumado ? `Sumado: ahora hay ${r.cantidad}` : 'Añadido al inventario');
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /inventario/lineas/:id — { cantidad (0..MAX), caducidad, notas }: lo
 * que hay de verdad. Cantidad 0 deja la línea («se acabó, hay que reponer»);
 * para quitarla del todo, DELETE. Cambiar la caducidad a una que ya tiene
 * otra línea de lo mismo da 409: serían dos líneas iguales.
 */
async function updateLinea(req, res, next) {
  try {
    const id = idOpcional(req.params.id);
    if (!id) return notFound(res, 'Elemento');
    const b = req.body || {};
    const cantidad = entero(b.cantidad, 0, MAX_CANTIDAD);
    if (Number.isNaN(cantidad)) return error(res, `La cantidad tiene que ser un número entero entre 0 y ${MAX_CANTIDAD}`, 400);
    const { caducidad, notas, fallo } = leerCaducidadYNotas(b);
    if (fallo) return error(res, fallo, 400);

    const t = ahora();
    const r = await transaction(async (conn) => {
      const [actuales] = await conn.query(
        `SELECT ${COLUMNAS_LINEA} ${DESDE_LINEA} WHERE i.id = ?`,
        [id]
      );
      const antes = actuales[0];
      if (!antes) return { status: 404, mensaje: 'Elemento no encontrado' };
      const vehiculo = await bloquearAmbulancia(conn, antes.vehicle_id);
      if (!vehiculo) return { status: 404, mensaje: 'Vehículo no encontrado' };
      const otra = await lineaIgual(conn, {
        vehicleId: antes.vehicle_id, productoId: antes.producto_id, nombre: antes.nombre, caducidad,
      }, id);
      if (otra) {
        return { status: 409, mensaje: 'Ya hay otra línea de esto con esa caducidad: corrige esa o borra una de las dos' };
      }
      await conn.query(
        'UPDATE vehiculo_inventario SET cantidad = ?, caducidad = ?, notas = ?, updated_at = ? WHERE id = ?',
        [cantidad, caducidad, notas, t, id]
      );
      return { antes, vehiculo };
    });
    if (r.status) return error(res, r.mensaje, r.status);

    const cambios = {};
    if (Number(r.antes.cantidad) !== cantidad) cambios.cantidad = { antes: Number(r.antes.cantidad), despues: cantidad };
    if ((r.antes.caducidad || null) !== caducidad) cambios.caducidad = { antes: r.antes.caducidad || null, despues: caducidad };
    if ((r.antes.notas || null) !== notas) cambios.notas = { antes: r.antes.notas || null, despues: notas };
    if (Object.keys(cambios).length) {
      await auditar(req, 'update_inventario_ambulancia', 'vehiculo_inventario', id, {
        vehiculo: nombreAmbulancia(r.vehiculo),
        vehicle_id: r.vehiculo.id,
        elemento: r.antes.nombre,
        cambios,
      });
    }
    return success(res, await leerLinea(id), 'Guardado');
  } catch (err) {
    next(err);
  }
}

/** DELETE /inventario/lineas/:id — quita la línea (lo que había queda en la auditoría). */
async function deleteLinea(req, res, next) {
  try {
    const id = idOpcional(req.params.id);
    if (!id) return notFound(res, 'Elemento');
    const r = await transaction(async (conn) => {
      const [actuales] = await conn.query(`SELECT ${COLUMNAS_LINEA} ${DESDE_LINEA} WHERE i.id = ?`, [id]);
      const linea = actuales[0];
      if (!linea) return { status: 404, mensaje: 'Elemento no encontrado' };
      const vehiculo = await bloquearAmbulancia(conn, linea.vehicle_id);
      await conn.query('DELETE FROM vehiculo_inventario WHERE id = ?', [id]);
      return { linea, vehiculo };
    });
    if (r.status) return error(res, r.mensaje, r.status);

    await auditar(req, 'delete_inventario_ambulancia', 'vehiculo_inventario', id, {
      vehiculo: r.vehiculo ? nombreAmbulancia(r.vehiculo) : null,
      vehicle_id: r.linea.vehicle_id,
      elemento: r.linea.nombre,
      caducidad: r.linea.caducidad || null,
      cantidad: Number(r.linea.cantidad),
    });
    return success(res, null, 'Quitado del inventario');
  } catch (err) {
    next(err);
  }
}

module.exports = { listAmbulancias, getAmbulancia, createLinea, updateLinea, deleteLinea };
