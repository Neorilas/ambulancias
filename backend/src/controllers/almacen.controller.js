/**
 * controllers/almacen.controller.js
 * Almacén de material (v44): catálogo, lotes con caducidad y movimientos.
 *
 * Solo administradores y superadmin, y oculto para el resto como Facturas
 * (almacen.routes.js, ocultarSalvoRoles). Sustituye al AppSheet
 * «AmbulanciaDB» (MAPA_CODIGO.md §2.10).
 *
 * El stock NO se guarda en ninguna columna: es la suma de `cantidad` (con
 * signo) de los movimientos de cada lote. Las salidas comprueban que hay
 * bastante dentro de una transacción con el lote bloqueado (FOR UPDATE), para
 * que dos salidas a la vez no dejen el lote en negativo.
 *
 * Las ambulancias todavía no tienen inventario propio (decisión del usuario,
 * 2026-11-18): una salida a una ambulancia solo dice a cuál fue. Cuando lo
 * tengan, esa misma salida pasará a ser un traslado almacén → ambulancia.
 */

'use strict';

const { query, transaction } = require('../config/database');
const { success, created, error, notFound, paginated } = require('../utils/response.utils');
const { ahora } = require('../utils/fecha.utils');
const { logAudit } = require('./admin.controller');

const MAX = { nombre: 150, presentacion: 30, destino: 150, notas: 255 };
const MAX_CANTIDAD = 100000;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const TIPOS_PRODUCTO = ['producto', 'medicacion'];
// Lo que se da de alta desde la pantalla. `ajuste` solo nace del recuento.
const TIPOS_SALIDA = ['salida_ambulancia', 'salida_otros', 'descarte'];
const TIPOS_MOVIMIENTO = ['entrada', ...TIPOS_SALIDA, 'ajuste'];

/** Texto recortado y sin espacios dobles, o null si viene vacío. */
function texto(v) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim().replace(/\s+/g, ' ');
  return t || null;
}

/** Id positivo; null si no viene, NaN si viene y no lo es. */
function idOpcional(v) {
  const t = texto(v);
  if (t === null) return null;
  return /^[1-9]\d{0,9}$/.test(t) ? Number(t) : NaN;
}

/** Entero dentro de [min, max]; NaN si no lo es. Acepta número o texto. */
function entero(v, min, max) {
  const t = texto(v);
  if (t === null || !/^-?\d{1,9}$/.test(t)) return NaN;
  const n = Number(t);
  return n >= min && n <= max ? n : NaN;
}

/**
 * Caducidad: 'YYYY-MM-DD' que existe, null si viene vacía (no caduca) y
 * undefined si viene y no vale.
 */
function caducidadValida(v) {
  const t = texto(v);
  if (t === null) return null;
  if (!FECHA.test(t)) return undefined;
  const d = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) return undefined;
  const anio = Number(t.slice(0, 4));
  return anio >= 2000 && anio <= 2100 ? t : undefined;
}

// Stock por lote. Un lote sin movimientos (recién creado y vaciado por un
// error de alta) da 0, no NULL.
const STOCK_LOTES = `SELECT l.id, l.producto_id, l.caducidad, COALESCE(SUM(m.cantidad), 0) AS stock
                       FROM material_lotes l
                       LEFT JOIN material_movimientos m ON m.lote_id = l.id
                      GROUP BY l.id, l.producto_id, l.caducidad`;

/**
 * Columnas del catálogo con su stock. `proxima_caducidad` es la del lote con
 * existencias que caduca antes (los vacíos no cuentan: ya no hay nada que
 * caduque). `lotes_negativos` cuenta los lotes con más salidas que entradas:
 * solo pasa con lo importado del AppSheet y la pantalla lo avisa.
 * DATE_FORMAT: un DATE leído con la sesión en UTC llegaría como Date a
 * medianoche y el navegador lo pintaría el día anterior.
 */
const COLUMNAS_PRODUCTO = `p.id, p.nombre, p.presentacion, p.tipo, p.stock_minimo, p.activo,
  COALESCE(SUM(ls.stock), 0) AS stock,
  DATE_FORMAT(MIN(CASE WHEN ls.stock > 0 THEN ls.caducidad END), '%Y-%m-%d') AS proxima_caducidad,
  COALESCE(SUM(ls.stock > 0), 0) AS lotes_con_stock,
  COALESCE(SUM(ls.stock < 0), 0) AS lotes_negativos`;

/** La fila como la quiere la pantalla: números como números y `activo` como booleano. */
function filaProducto(p) {
  return {
    ...p,
    stock: Number(p.stock),
    stock_minimo: Number(p.stock_minimo),
    lotes_con_stock: Number(p.lotes_con_stock),
    lotes_negativos: Number(p.lotes_negativos),
    activo: Boolean(p.activo),
  };
}

async function auditar(req, action, entityType, entityId, details) {
  await logAudit({
    userId:    req.user.id,
    userInfo:  req.user.username,
    action,
    entityType,
    entityId,
    details,
    ip:        req.ip,
    userAgent: req.headers['user-agent'],
  });
}

// ── Catálogo ──────────────────────────────────────────────────────────────────

/**
 * GET /almacen/productos — el catálogo entero con su stock. Son unos
 * doscientos: va sin paginar y la pantalla filtra y busca en el navegador.
 */
async function listProductos(req, res, next) {
  try {
    const [filas] = await query(
      `SELECT ${COLUMNAS_PRODUCTO}
         FROM material_productos p
         LEFT JOIN (${STOCK_LOTES}) ls ON ls.producto_id = p.id
        GROUP BY p.id
        ORDER BY p.nombre, p.id`
    );
    return success(res, filas.map(filaProducto));
  } catch (err) {
    next(err);
  }
}

/** El producto con su stock, o null. Usa la conexión de la transacción si la hay. */
async function leerProducto(id, conn = null) {
  const sql = `SELECT ${COLUMNAS_PRODUCTO}
                 FROM material_productos p
                 LEFT JOIN (${STOCK_LOTES}) ls ON ls.producto_id = p.id
                WHERE p.id = ?
                GROUP BY p.id`;
  const [filas] = conn ? await conn.query(sql, [id]) : await query(sql, [id]);
  return filas[0] ? filaProducto(filas[0]) : null;
}

/**
 * GET /almacen/productos/:id — el producto, sus lotes (los vacíos también:
 * la pantalla los pliega) y sus últimos movimientos.
 */
async function getProducto(req, res, next) {
  try {
    const id = idOpcional(req.params.id);
    if (!id) return notFound(res, 'Producto');
    const producto = await leerProducto(id);
    if (!producto) return notFound(res, 'Producto');

    const [lotes] = await query(
      `SELECT ls.id, DATE_FORMAT(ls.caducidad, '%Y-%m-%d') AS caducidad, ls.stock
         FROM (${STOCK_LOTES}) ls
        WHERE ls.producto_id = ?
        ORDER BY ls.caducidad IS NULL, ls.caducidad, ls.id`,
      [id]
    );
    return success(res, {
      ...producto,
      lotes: lotes.map(l => ({ ...l, stock: Number(l.stock) })),
    });
  } catch (err) {
    next(err);
  }
}

/** Lee y valida los campos del producto. Devuelve { datos } o { error }. */
function leerCamposProducto(body, { parcial = false } = {}) {
  const datos = {};
  const nombre = texto(body?.nombre);
  if (nombre !== null || !parcial) {
    if (!nombre) return { error: 'El nombre es obligatorio' };
    if (nombre.length > MAX.nombre) return { error: `El nombre no puede pasar de ${MAX.nombre} caracteres` };
    datos.nombre = nombre;
  }
  const presentacion = texto(body?.presentacion);
  if (presentacion !== null || !parcial) {
    const p = presentacion || 'Unidad';
    if (p.length > MAX.presentacion) return { error: `La presentación no puede pasar de ${MAX.presentacion} caracteres` };
    datos.presentacion = p;
  }
  if (body?.tipo !== undefined || !parcial) {
    const tipo = texto(body?.tipo) || 'producto';
    if (!TIPOS_PRODUCTO.includes(tipo)) return { error: 'Tipo no válido: producto o medicación' };
    datos.tipo = tipo;
  }
  if (body?.stock_minimo !== undefined || !parcial) {
    const min = texto(body?.stock_minimo) === null ? 0 : entero(body.stock_minimo, 0, MAX_CANTIDAD);
    if (Number.isNaN(min)) return { error: 'El stock mínimo tiene que ser un número entero, 0 o más' };
    datos.stock_minimo = min;
  }
  if (parcial && body?.activo !== undefined) {
    if (typeof body.activo !== 'boolean') return { error: 'activo tiene que ser verdadero o falso' };
    datos.activo = body.activo ? 1 : 0;
  }
  return { datos };
}

/** ¿Hay otro producto activo con el mismo nombre? (sin distinguir mayúsculas ni tildes, por la collation) */
async function nombreRepetido(nombre, excepto = null) {
  const [filas] = await query(
    `SELECT id FROM material_productos WHERE nombre = ? AND activo = 1 ${excepto ? 'AND id <> ?' : ''} LIMIT 1`,
    excepto ? [nombre, excepto] : [nombre]
  );
  return filas.length > 0;
}

/** POST /almacen/productos */
async function createProducto(req, res, next) {
  try {
    const { datos, error: motivo } = leerCamposProducto(req.body);
    if (motivo) return error(res, motivo, 400);
    if (await nombreRepetido(datos.nombre)) {
      return error(res, `Ya hay un producto «${datos.nombre}» en el catálogo`, 409);
    }
    const t = ahora();
    const [r] = await query(
      `INSERT INTO material_productos (nombre, presentacion, tipo, stock_minimo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [datos.nombre, datos.presentacion, datos.tipo, datos.stock_minimo, t, t]
    );
    await auditar(req, 'create_material_producto', 'material_producto', r.insertId, datos);
    return created(res, await leerProducto(r.insertId), 'Producto añadido');
  } catch (err) {
    next(err);
  }
}

/** PUT /almacen/productos/:id — cambia lo que llegue. `activo: false` lo retira del catálogo sin perder su historial. */
async function updateProducto(req, res, next) {
  try {
    const id = idOpcional(req.params.id);
    if (!id) return notFound(res, 'Producto');
    const antes = await leerProducto(id);
    if (!antes) return notFound(res, 'Producto');

    const { datos, error: motivo } = leerCamposProducto(req.body, { parcial: true });
    if (motivo) return error(res, motivo, 400);
    const campos = Object.keys(datos);
    if (campos.length === 0) return error(res, 'No hay nada que cambiar', 400);
    const nombreFinal = datos.nombre ?? antes.nombre;
    const activoFinal = datos.activo ?? (antes.activo ? 1 : 0);
    if (activoFinal && (datos.nombre || datos.activo) && await nombreRepetido(nombreFinal, id)) {
      return error(res, `Ya hay un producto «${nombreFinal}» en el catálogo`, 409);
    }

    await query(
      `UPDATE material_productos SET ${campos.map(c => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      [...campos.map(c => datos[c]), ahora(), id]
    );
    const cambios = {};
    for (const c of campos) {
      const previo = c === 'activo' ? (antes.activo ? 1 : 0) : antes[c];
      if (previo !== datos[c]) cambios[c] = { antes: previo, despues: datos[c] };
    }
    if (Object.keys(cambios).length) {
      await auditar(req, 'update_material_producto', 'material_producto', id, { nombre: nombreFinal, cambios });
    }
    return success(res, await leerProducto(id), 'Producto guardado');
  } catch (err) {
    next(err);
  }
}

// ── Lotes ─────────────────────────────────────────────────────────────────────

/**
 * PUT /almacen/lotes/:id — corrige la caducidad de un lote mal apuntado
 * (el AppSheet tiene alguno con la fecha cambiada). Si ya hay otro lote del
 * mismo producto con esa caducidad, se avisa: serían dos lotes iguales.
 */
async function updateLote(req, res, next) {
  try {
    const id = idOpcional(req.params.id);
    if (!id) return notFound(res, 'Lote');
    const caducidad = caducidadValida(req.body?.caducidad);
    if (caducidad === undefined) return error(res, 'Caducidad no válida', 400);

    const [lotes] = await query(
      `SELECT l.id, l.producto_id, DATE_FORMAT(l.caducidad, '%Y-%m-%d') AS caducidad, p.nombre
         FROM material_lotes l JOIN material_productos p ON p.id = l.producto_id
        WHERE l.id = ?`,
      [id]
    );
    const lote = lotes[0];
    if (!lote) return notFound(res, 'Lote');
    if (lote.caducidad === caducidad) return success(res, { id, caducidad }, 'Sin cambios');

    const [iguales] = await query(
      `SELECT id FROM material_lotes WHERE producto_id = ? AND id <> ? AND ${caducidad ? 'caducidad = ?' : 'caducidad IS NULL'} LIMIT 1`,
      caducidad ? [lote.producto_id, id, caducidad] : [lote.producto_id, id]
    );
    if (iguales.length) {
      return error(res, 'Ya hay otro lote de este producto con esa caducidad', 409);
    }

    await query('UPDATE material_lotes SET caducidad = ? WHERE id = ?', [caducidad, id]);
    await auditar(req, 'update_material_lote', 'material_lote', id,
      { producto: lote.nombre, caducidad: { antes: lote.caducidad, despues: caducidad } });
    return success(res, { id, caducidad }, 'Caducidad corregida');
  } catch (err) {
    next(err);
  }
}

/** Stock del lote bloqueándolo hasta el fin de la transacción. null si no existe. */
async function bloquearLote(conn, loteId) {
  const [lotes] = await conn.query(
    `SELECT l.id, l.producto_id, DATE_FORMAT(l.caducidad, '%Y-%m-%d') AS caducidad, p.nombre, p.activo
       FROM material_lotes l JOIN material_productos p ON p.id = l.producto_id
      WHERE l.id = ? FOR UPDATE`,
    [loteId]
  );
  if (!lotes[0]) return null;
  const [suma] = await conn.query(
    'SELECT COALESCE(SUM(cantidad), 0) AS stock FROM material_movimientos WHERE lote_id = ?',
    [loteId]
  );
  return { ...lotes[0], stock: Number(suma[0].stock) };
}

/**
 * POST /almacen/lotes/:id/recuento — { stock_real, notas? }: lo contado en la
 * estantería. Apunta un `ajuste` por la diferencia; si cuadra, no apunta nada.
 * Es la forma de corregir un error (una entrada de 6000 en vez de 6) sin
 * borrar historia.
 */
async function recuentoLote(req, res, next) {
  try {
    const id = idOpcional(req.params.id);
    if (!id) return notFound(res, 'Lote');
    const real = entero(req.body?.stock_real, 0, MAX_CANTIDAD);
    if (Number.isNaN(real)) return error(res, 'Lo contado tiene que ser un número entero, 0 o más', 400);
    const notas = texto(req.body?.notas);
    if (notas && notas.length > MAX.notas) return error(res, `Las notas no pueden pasar de ${MAX.notas} caracteres`, 400);

    const resultado = await transaction(async (conn) => {
      const lote = await bloquearLote(conn, id);
      if (!lote) return { noExiste: true };
      const diferencia = real - lote.stock;
      if (diferencia === 0) return { lote, diferencia };
      const t = ahora();
      const [r] = await conn.query(
        `INSERT INTO material_movimientos (lote_id, tipo, cantidad, notas, user_id, fecha, created_at)
         VALUES (?, 'ajuste', ?, ?, ?, ?, ?)`,
        [id, diferencia, notas || 'Recuento', req.user.id, t, t]
      );
      return { lote, diferencia, movimientoId: r.insertId };
    });
    if (resultado.noExiste) return notFound(res, 'Lote');

    const { lote, diferencia, movimientoId } = resultado;
    if (diferencia === 0) {
      return success(res, { lote_id: id, stock: real, diferencia: 0 }, 'El recuento cuadra: no se ha apuntado nada');
    }
    await auditar(req, 'recuento_material', 'material_movimiento', movimientoId,
      { producto: lote.nombre, lote_id: id, caducidad: lote.caducidad, antes: lote.stock, contado: real, diferencia });
    return created(res, { lote_id: id, stock: real, diferencia, movimiento_id: movimientoId }, 'Recuento apuntado');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /almacen/productos/:id/recuento — el recuento de un producto entero, de
 * una vez: { lotes: [{ lote_id, stock_real }], nuevos: [{ caducidad, stock_real }], notas? }.
 *
 * Existe porque un lote en negativo casi nunca es «faltan»: es que en el
 * AppSheet se sacaron unidades apuntando el lote equivocado, y el otro lote
 * está inflado. Cuadrar solo el rojo deja el otro mal; hay que contar todos.
 * - `lotes`: los contados. Los que no vienen no se tocan (no contado ≠ 0).
 * - `nuevos`: unidades con una caducidad que no está en la app; crea el lote
 *   con un ajuste. Si esa caducidad ya tiene lote, se cuenta en su fila (409).
 * Todo en una transacción: o se apunta el recuento entero o nada.
 */
async function recuentoProducto(req, res, next) {
  try {
    const id = idOpcional(req.params.id);
    if (!id) return notFound(res, 'Producto');
    const notas = texto(req.body?.notas);
    if (notas && notas.length > MAX.notas) return error(res, `Las notas no pueden pasar de ${MAX.notas} caracteres`, 400);

    const crudosLotes = Array.isArray(req.body?.lotes) ? req.body.lotes : [];
    const crudosNuevos = Array.isArray(req.body?.nuevos) ? req.body.nuevos : [];
    if (!crudosLotes.length && !crudosNuevos.length) return error(res, 'No has contado ningún lote', 400);
    if (crudosLotes.length + crudosNuevos.length > 200) return error(res, 'Demasiados lotes en un recuento', 400);

    const contados = [];
    const vistos = new Set();
    for (const l of crudosLotes) {
      const loteId = idOpcional(l?.lote_id);
      const real = entero(l?.stock_real, 0, MAX_CANTIDAD);
      if (!loteId || Number.isNaN(real)) return error(res, 'Lo contado tiene que ser un número entero, 0 o más', 400);
      if (vistos.has(loteId)) return error(res, 'Un lote viene dos veces en el recuento', 400);
      vistos.add(loteId);
      contados.push({ loteId, real });
    }
    const nuevos = [];
    const fechas = new Set();
    for (const n of crudosNuevos) {
      const caducidad = caducidadValida(n?.caducidad);
      const real = entero(n?.stock_real, 1, MAX_CANTIDAD);
      if (caducidad === undefined) return error(res, 'Caducidad no válida en un lote nuevo', 400);
      if (Number.isNaN(real)) return error(res, 'Un lote nuevo tiene que tener 1 unidad o más', 400);
      const clave = caducidad || 'sin';
      if (fechas.has(clave)) return error(res, 'Hay dos lotes nuevos con la misma caducidad', 400);
      fechas.add(clave);
      nuevos.push({ caducidad, real });
    }

    const resultado = await transaction(async (conn) => {
      const [prods] = await conn.query('SELECT id, nombre, activo FROM material_productos WHERE id = ? FOR UPDATE', [id]);
      const producto = prods[0];
      if (!producto) return { noExiste: true };
      if (nuevos.length && !producto.activo) return { fallo: 'El producto está retirado: no se le pueden añadir lotes' };

      const t = ahora();
      const nota = notas || 'Recuento';
      const detalle = [];
      for (const c of contados) {
        const lote = await bloquearLote(conn, c.loteId);
        if (!lote || lote.producto_id !== id) return { fallo: 'Algún lote no es de este producto: recarga y vuelve a contar', estado: 409 };
        const diferencia = c.real - lote.stock;
        if (diferencia === 0) continue;
        await conn.query(
          `INSERT INTO material_movimientos (lote_id, tipo, cantidad, notas, user_id, fecha, created_at)
           VALUES (?, 'ajuste', ?, ?, ?, ?, ?)`,
          [c.loteId, diferencia, nota, req.user.id, t, t]
        );
        detalle.push({ lote_id: c.loteId, caducidad: lote.caducidad, antes: lote.stock, contado: c.real, diferencia });
      }
      for (const n of nuevos) {
        const [iguales] = await conn.query(
          `SELECT id FROM material_lotes WHERE producto_id = ? AND ${n.caducidad ? 'caducidad = ?' : 'caducidad IS NULL'} LIMIT 1`,
          n.caducidad ? [id, n.caducidad] : [id]
        );
        if (iguales.length) {
          return { fallo: `Ya hay un lote ${n.caducidad ? `que caduca el ${n.caducidad.split('-').reverse().join('/')}` : 'sin caducidad'}: cuéntalo en su fila`, estado: 409 };
        }
        const [l] = await conn.query('INSERT INTO material_lotes (producto_id, caducidad, created_at) VALUES (?, ?, ?)', [id, n.caducidad, t]);
        await conn.query(
          `INSERT INTO material_movimientos (lote_id, tipo, cantidad, notas, user_id, fecha, created_at)
           VALUES (?, 'ajuste', ?, ?, ?, ?, ?)`,
          [l.insertId, n.real, nota, req.user.id, t, t]
        );
        detalle.push({ lote_id: l.insertId, caducidad: n.caducidad, antes: 0, contado: n.real, diferencia: n.real, nuevo: true });
      }
      return { producto, detalle, final: await leerProducto(id, conn) };
    });
    if (resultado.noExiste) return notFound(res, 'Producto');
    if (resultado.fallo) return error(res, resultado.fallo, resultado.estado || 400);

    const { producto, detalle, final } = resultado;
    if (detalle.length) {
      await auditar(req, 'recuento_material_producto', 'material_producto', id, { producto: producto.nombre, lotes: detalle });
    }
    const mensaje = detalle.length === 0
      ? 'El recuento cuadra: no se ha apuntado nada'
      : `Recuento apuntado: ${detalle.length} ${detalle.length === 1 ? 'lote ajustado' : 'lotes ajustados'}`;
    return success(res, { producto: final, ajustes: detalle }, mensaje);
  } catch (err) {
    next(err);
  }
}

// ── Movimientos ───────────────────────────────────────────────────────────────

/** Ambulancia viva, o null. */
async function ambulancia(conn, id) {
  const [filas] = await conn.query(
    'SELECT id, alias, matricula FROM vehicles WHERE id = ? AND deleted_at IS NULL',
    [id]
  );
  return filas[0] || null;
}

/**
 * POST /almacen/movimientos
 *  - entrada:            { producto_id, caducidad (vacía = no caduca), cantidad, notas? }
 *                        Reutiliza el lote del producto con esa caducidad o lo crea.
 *  - salida_ambulancia:  { lote_id, cantidad, vehicle_id, notas? }
 *  - salida_otros:       { lote_id, cantidad, destino, notas? }
 *  - descarte:           { lote_id, cantidad, notas? } (caducado, roto…)
 * Una salida nunca deja el lote en negativo: 409 con lo que queda.
 */
async function createMovimiento(req, res, next) {
  try {
    const b = req.body || {};
    const tipo = texto(b.tipo);
    if (tipo !== 'entrada' && !TIPOS_SALIDA.includes(tipo)) {
      return error(res, 'Tipo de movimiento no válido', 400);
    }
    const cantidad = entero(b.cantidad, 1, MAX_CANTIDAD);
    if (Number.isNaN(cantidad)) return error(res, `La cantidad tiene que ser un número entero entre 1 y ${MAX_CANTIDAD}`, 400);
    const notas = texto(b.notas);
    if (notas && notas.length > MAX.notas) return error(res, `Las notas no pueden pasar de ${MAX.notas} caracteres`, 400);

    let productoId = null;
    let caducidad = null;
    let loteId = null;
    let vehiculoId = null;
    let destino = null;
    if (tipo === 'entrada') {
      productoId = idOpcional(b.producto_id);
      if (!productoId) return error(res, 'Falta el producto', 400);
      caducidad = caducidadValida(b.caducidad);
      if (caducidad === undefined) return error(res, 'Caducidad no válida', 400);
    } else {
      loteId = idOpcional(b.lote_id);
      if (!loteId) return error(res, 'Falta el lote del que sale', 400);
      if (tipo === 'salida_ambulancia') {
        vehiculoId = idOpcional(b.vehicle_id);
        if (!vehiculoId) return error(res, 'Falta la ambulancia', 400);
      }
      if (tipo === 'salida_otros') {
        destino = texto(b.destino);
        if (!destino) return error(res, 'Di adónde va el material', 400);
        if (destino.length > MAX.destino) return error(res, `El destino no puede pasar de ${MAX.destino} caracteres`, 400);
      }
    }

    const t = ahora();
    const resultado = await transaction(async (conn) => {
      if (tipo === 'entrada') {
        const [productos] = await conn.query(
          'SELECT id, nombre, activo FROM material_productos WHERE id = ? FOR UPDATE',
          [productoId]
        );
        const producto = productos[0];
        if (!producto) return { status: 404, mensaje: 'Producto no encontrado' };
        if (!producto.activo) return { status: 409, mensaje: 'Ese producto está retirado del catálogo: reactívalo antes de darle entrada' };
        // El producto bloqueado hace de candado: dos entradas a la vez con la
        // misma caducidad no crean dos lotes iguales.
        const [lotes] = await conn.query(
          `SELECT id FROM material_lotes WHERE producto_id = ? AND ${caducidad ? 'caducidad = ?' : 'caducidad IS NULL'}
            ORDER BY id LIMIT 1`,
          caducidad ? [productoId, caducidad] : [productoId]
        );
        let lote = lotes[0]?.id;
        if (!lote) {
          const [nuevo] = await conn.query(
            'INSERT INTO material_lotes (producto_id, caducidad, created_at) VALUES (?, ?, ?)',
            [productoId, caducidad, t]
          );
          lote = nuevo.insertId;
        }
        const [r] = await conn.query(
          `INSERT INTO material_movimientos (lote_id, tipo, cantidad, notas, user_id, fecha, created_at)
           VALUES (?, 'entrada', ?, ?, ?, ?, ?)`,
          [lote, cantidad, notas, req.user.id, t, t]
        );
        return { id: r.insertId, loteId: lote, producto: producto.nombre, productoId };
      }

      const lote = await bloquearLote(conn, loteId);
      if (!lote) return { status: 404, mensaje: 'Lote no encontrado' };
      if (cantidad > lote.stock) {
        return {
          status: 409,
          mensaje: lote.stock > 0
            ? `De ese lote solo quedan ${lote.stock}`
            : 'De ese lote no queda nada en el almacén',
        };
      }
      let vehiculo = null;
      if (vehiculoId) {
        vehiculo = await ambulancia(conn, vehiculoId);
        if (!vehiculo) return { status: 422, mensaje: 'Esa ambulancia no existe o está dada de baja' };
      }
      const [r] = await conn.query(
        `INSERT INTO material_movimientos (lote_id, tipo, cantidad, vehicle_id, destino, notas, user_id, fecha, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [loteId, tipo, -cantidad, vehiculoId, destino, notas, req.user.id, t, t]
      );
      return { id: r.insertId, loteId, producto: lote.nombre, productoId: lote.producto_id, caducidad: lote.caducidad, vehiculo };
    });

    if (resultado.status) return error(res, resultado.mensaje, resultado.status);

    await auditar(req, 'material_movimiento', 'material_movimiento', resultado.id, {
      tipo,
      producto: resultado.producto,
      lote_id: resultado.loteId,
      caducidad: tipo === 'entrada' ? caducidad : resultado.caducidad,
      cantidad,
      ...(resultado.vehiculo && { vehiculo: resultado.vehiculo.alias || resultado.vehiculo.matricula }),
      ...(destino && { destino }),
    });
    return created(res, {
      id: resultado.id,
      lote_id: resultado.loteId,
      producto: await leerProducto(resultado.productoId),
    }, tipo === 'entrada' ? 'Entrada apuntada' : 'Salida apuntada');
  } catch (err) {
    next(err);
  }
}

/**
 * GET /almacen/movimientos — el historial, el más reciente primero, de 50 en
 * 50. Filtros: producto_id, vehicle_id, tipo.
 */
async function listMovimientos(req, res, next) {
  try {
    const q = req.query || {};
    const page = Math.max(1, entero(q.page, 1, 100000) || 1);
    const limit = Math.min(100, Math.max(1, entero(q.limit, 1, 100) || 50));
    const where = [];
    const params = [];
    const producto = idOpcional(q.producto_id);
    const vehiculo = idOpcional(q.vehicle_id);
    if (Number.isNaN(producto) || Number.isNaN(vehiculo)) return error(res, 'Filtro no válido', 400);
    if (producto) { where.push('l.producto_id = ?'); params.push(producto); }
    if (vehiculo) { where.push('m.vehicle_id = ?'); params.push(vehiculo); }
    const tipo = texto(Array.isArray(q.tipo) ? q.tipo[0] : q.tipo);
    if (tipo) {
      if (!TIPOS_MOVIMIENTO.includes(tipo)) return error(res, 'Tipo no válido', 400);
      where.push('m.tipo = ?'); params.push(tipo);
    }
    const condicion = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [[{ total }]] = await query(
      `SELECT COUNT(*) AS total FROM material_movimientos m JOIN material_lotes l ON l.id = m.lote_id ${condicion}`,
      params
    );
    const [filas] = await query(
      `SELECT m.id, m.tipo, m.cantidad, m.destino, m.notas, m.fecha,
              m.lote_id, DATE_FORMAT(l.caducidad, '%Y-%m-%d') AS caducidad,
              p.id AS producto_id, p.nombre AS producto, p.presentacion,
              m.vehicle_id, v.alias AS vehiculo_alias,
              SUBSTRING_INDEX(v.matricula, '__del_', 1) AS vehiculo_matricula,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.nombre, ''), ' ', COALESCE(u.apellidos, ''))), ''), m.usuario_origen) AS usuario,
              (m.codigo_origen IS NOT NULL) AS importado
         FROM material_movimientos m
         JOIN material_lotes l ON l.id = m.lote_id
         JOIN material_productos p ON p.id = l.producto_id
         LEFT JOIN vehicles v ON v.id = m.vehicle_id
         LEFT JOIN users u ON u.id = m.user_id
        ${condicion}
        ORDER BY m.fecha DESC, m.id DESC
        LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit]
    );
    return paginated(res, {
      data: filas.map(f => ({ ...f, importado: Boolean(f.importado) })),
      total: Number(total),
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listProductos,
  getProducto,
  createProducto,
  updateProducto,
  updateLote,
  recuentoLote,
  recuentoProducto,
  createMovimiento,
  listMovimientos,
  // para los tests
  caducidadValida,
  entero,
};
