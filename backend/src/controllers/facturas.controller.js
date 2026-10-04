/**
 * controllers/facturas.controller.js
 * Facturas de proveedores (Google Ads y los que vengan) para descargar.
 *
 * Solo administradores y superadmin (lo pone facturas.routes.js por rol).
 * El PDF vive en la columna `contenido` de `facturas` (v32), nunca en
 * uploads/: eso se sirve estático y sin sesión. Por eso el listado nombra las
 * columnas una a una y jamás hace `SELECT *`: traería todos los PDF enteros.
 *
 * Hoy entran a mano (origen 'manual'). La columna `origen` y el UNIQUE
 * (proveedor, numero) están pensados para que un día lleguen solas desde el
 * buzón de facturas sin duplicar las subidas a mano.
 */

'use strict';

const { query } = require('../config/database');
const { success, created, error, notFound } = require('../utils/response.utils');
const { ahora, fechaEnEspana } = require('../utils/fecha.utils');
const { logAudit } = require('./admin.controller');

const MAX = { proveedor: 100, numero: 64, notas: 255, nombre: 255 };
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Lo que ve la pantalla. DATE_FORMAT: un DATE leído con la sesión en UTC
// llega como Date a medianoche y el navegador lo pintaría el día anterior.
const COLUMNAS = `f.id, f.proveedor, f.numero,
  DATE_FORMAT(f.fecha_emision, '%Y-%m-%d') AS fecha_emision,
  f.importe, f.notas, f.nombre_fichero, f.tamano, f.origen, f.created_at,
  f.subido_por, TRIM(CONCAT(COALESCE(u.nombre, ''), ' ', COALESCE(u.apellidos, ''))) AS subido_por_nombre`;

/** Texto recortado, o null si viene vacío. */
function texto(v) {
  if (v === undefined || v === null) return null;
  const t = String(v).trim().replace(/\s+/g, ' ');
  return t || null;
}

/** 'YYYY-MM-DD' que existe en el calendario, o null. */
function fechaValida(v) {
  const t = texto(v);
  if (!t || !FECHA.test(t)) return null;
  const d = new Date(`${t}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t ? t : null;
}

/**
 * Importe en euros: acepta «65,23», «65.23», «1.234» y «1.234,56». undefined si no
 * viene (es opcional); NaN si viene y no se entiende.
 */
function importeValido(v) {
  const t = texto(v);
  if (t === null) return undefined;
  let s = t.replace(/\s|€/g, '');
  // «1.234,56» y «1.234»: el punto es de miles (lo mismo acepta la pantalla)
  if (s.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(s)) return NaN;
  return Number(s);
}

/** El fichero empieza por `%PDF-`. El mimetype del navegador no prueba nada. */
function esPdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

/** Nombre de descarga sin caracteres que rompan la cabecera ni la ruta. */
function nombreDescarga(f) {
  const limpio = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return `Factura_${limpio(f.proveedor) || 'proveedor'}_${limpio(f.numero) || f.id}.pdf`;
}

/** GET /facturas — todas, la más reciente primero (son pocas: una al mes por proveedor). */
async function listFacturas(req, res, next) {
  try {
    const [filas] = await query(
      `SELECT ${COLUMNAS}
         FROM facturas f
         LEFT JOIN users u ON u.id = f.subido_por
        ORDER BY f.fecha_emision DESC, f.id DESC`
    );
    return success(res, filas.map(f => ({
      ...f,
      importe: f.importe === null ? null : Number(f.importe),
    })));
  } catch (err) {
    next(err);
  }
}

/** POST /facturas (multipart: `fichero` + proveedor, numero, fecha_emision, importe?, notas?) */
async function createFactura(req, res, next) {
  try {
    const fichero = req.file;
    if (!fichero) return error(res, 'Falta el PDF de la factura', 400);
    if (!esPdf(fichero.buffer)) return error(res, 'El fichero no es un PDF', 400);

    const proveedor = texto(req.body?.proveedor);
    const numero    = texto(req.body?.numero);
    const fecha     = fechaValida(req.body?.fecha_emision);
    const importe   = importeValido(req.body?.importe);
    const notas     = texto(req.body?.notas);

    const errores = [];
    if (!proveedor || proveedor.length > MAX.proveedor) errores.push({ campo: 'proveedor', msg: `Indica el proveedor (máx. ${MAX.proveedor} caracteres)` });
    if (!numero || numero.length > MAX.numero)          errores.push({ campo: 'numero', msg: `Indica el número de factura (máx. ${MAX.numero} caracteres)` });
    if (!fecha)                                          errores.push({ campo: 'fecha_emision', msg: 'Fecha de emisión no válida (AAAA-MM-DD)' });
    else if (fecha > fechaEnEspana(ahora()))             errores.push({ campo: 'fecha_emision', msg: 'La fecha de emisión no puede ser futura' });
    if (Number.isNaN(importe))                           errores.push({ campo: 'importe', msg: 'Importe no válido' });
    if (notas && notas.length > MAX.notas)               errores.push({ campo: 'notas', msg: `Las notas no pueden pasar de ${MAX.notas} caracteres` });
    if (errores.length) return error(res, errores[0].msg, 422, errores);

    const nombre = (texto(fichero.originalname) || 'factura.pdf').slice(0, MAX.nombre);

    let resultado;
    try {
      [resultado] = await query(
        `INSERT INTO facturas
           (proveedor, numero, fecha_emision, importe, notas, nombre_fichero, tamano, contenido, origen, subido_por, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`,
        [proveedor, numero, fecha, importe ?? null, notas, nombre, fichero.size, fichero.buffer, req.user.id, ahora()]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return error(res, `Ya hay una factura ${numero} de ${proveedor}`, 409);
      }
      throw err;
    }

    await logAudit({
      userId:     req.user.id,
      userInfo:   req.user.username,
      action:     'create_factura',
      entityType: 'factura',
      entityId:   resultado.insertId,
      details:    { proveedor, numero, fecha_emision: fecha, importe: importe ?? null, tamano: fichero.size },
      ip:         req.ip,
      userAgent:  req.headers['user-agent'],
    });

    const [filas] = await query(
      `SELECT ${COLUMNAS} FROM facturas f LEFT JOIN users u ON u.id = f.subido_por WHERE f.id = ?`,
      [resultado.insertId]
    );
    const factura = filas[0];
    return created(res, factura && { ...factura, importe: factura.importe === null ? null : Number(factura.importe) }, 'Factura guardada');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /facturas/leer (multipart: `fichero`) — paso 1 de la subida: lee el PDF
 * y devuelve lo que ha sacado, SIN guardar nada. El paso 2 es el formulario
 * relleno con esto, que el admin revisa y completa; al guardar, el PDF vuelve
 * a subir con POST /facturas (son pocos KB, y así no queda nada a medias en
 * el servidor si cierra el formulario).
 * Responde { con_texto, datos: { proveedor, numero, fecha_emision, importe }, duplicada }.
 */
async function leerFactura(req, res, next) {
  try {
    const fichero = req.file;
    if (!fichero) return error(res, 'Falta el PDF de la factura', 400);
    if (!esPdf(fichero.buffer)) return error(res, 'El fichero no es un PDF', 400);

    // Los proveedores ya guardados: si el PDF nombra a uno, se escribe igual
    // y el UNIQUE (proveedor, numero) detecta la repetida.
    const [provs] = await query('SELECT DISTINCT proveedor FROM facturas');
    const { con_texto, datos } = await lector().leerFactura(fichero.buffer, {
      nombreFichero: fichero.originalname,
      proveedores:   provs.map(p => p.proveedor),
    });

    let duplicada = false;
    if (datos.proveedor && datos.numero) {
      const [ya] = await query('SELECT id FROM facturas WHERE proveedor = ? AND numero = ? LIMIT 1', [datos.proveedor, datos.numero]);
      duplicada = ya.length > 0;
    }
    return success(res, { con_texto, datos, duplicada });
  } catch (err) {
    next(err);
  }
}

/** GET /facturas/:id/descarga — el PDF, como descarga y sin caché. */
async function downloadFactura(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return error(res, 'Factura no válida', 400);

    const [filas] = await query(
      'SELECT id, proveedor, numero, contenido FROM facturas WHERE id = ?', [id]
    );
    const f = filas[0];
    if (!f) return notFound(res, 'Factura');

    const contenido = Buffer.isBuffer(f.contenido) ? f.contenido : Buffer.from(f.contenido || []);
    res.set({
      'Content-Type':           'application/pdf',
      'Content-Length':         String(contenido.length),
      'Content-Disposition':    `attachment; filename="${nombreDescarga(f)}"`,
      'Cache-Control':          'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.status(200).send(contenido);
  } catch (err) {
    next(err);
  }
}

/** DELETE /facturas/:id — para corregir una subida equivocada. Queda en la auditoría. */
async function deleteFactura(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return error(res, 'Factura no válida', 400);

    const [filas] = await query(
      `SELECT id, proveedor, numero, DATE_FORMAT(fecha_emision, '%Y-%m-%d') AS fecha_emision, importe, origen
         FROM facturas WHERE id = ?`, [id]
    );
    const f = filas[0];
    if (!f) return notFound(res, 'Factura');

    await query('DELETE FROM facturas WHERE id = ?', [id]);

    await logAudit({
      userId:     req.user.id,
      userInfo:   req.user.username,
      action:     'delete_factura',
      entityType: 'factura',
      entityId:   id,
      details:    { proveedor: f.proveedor, numero: f.numero, fecha_emision: f.fecha_emision,
                    importe: f.importe === null ? null : Number(f.importe), origen: f.origen },
      ip:         req.ip,
      userAgent:  req.headers['user-agent'],
    });

    return success(res, null, 'Factura eliminada');
  } catch (err) {
    next(err);
  }
}

// Los servicios del buzón y del lector usan esPdf, importeValido y fechaValida
// de aquí: se cargan al usarlos para no hacer un require circular.
const buzon = () => require('../services/buzonFacturas.service');
const lector = () => require('../services/lectorFacturas.service');

/** GET /facturas/buzon — si el buzón está configurado y cómo fue la última revisión. */
function getBuzon(_req, res) {
  return success(res, buzon().estado());
}

/** POST /facturas/buzon/revisar — revisa el buzón ahora, sin esperar al cron. */
async function revisarBuzon(req, res) {
  const b = buzon();
  if (!b.configurado()) return error(res, 'El buzón de facturas no está configurado en el servidor', 409);
  const resultado = await b.revisarBuzon();
  return success(res, { ...b.estado(), ultima: resultado });
}

module.exports = {
  listFacturas, createFactura, leerFactura, downloadFactura, deleteFactura, getBuzon, revisarBuzon,
  // para los tests
  importeValido, fechaValida, esPdf, nombreDescarga,
};
