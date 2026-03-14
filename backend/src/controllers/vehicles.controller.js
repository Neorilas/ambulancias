/**
 * controllers/vehicles.controller.js
 * CRUD de vehículos + gestión de imágenes
 */

'use strict';

const { query, transaction }  = require('../config/database');
const { success, created, error, notFound, paginated } = require('../utils/response.utils');
const { PAGINATION, IMAGEN_TIPOS } = require('../config/constants');
const { isAdmin }             = require('../middleware/roles.middleware');
const { deleteFile }          = require('../middleware/upload.middleware');

// ============================================================
// GET /vehicles
// ============================================================
async function listVehicles(req, res, next) {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || PAGINATION.DEFAULT_PAGE);
    const limit  = Math.min(parseInt(req.query.limit) || PAGINATION.DEFAULT_LIMIT, PAGINATION.MAX_LIMIT);
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;

    let where  = 'WHERE v.deleted_at IS NULL';
    const params = [];

    if (search) {
      where += ' AND (v.matricula LIKE ? OR v.alias LIKE ?)';
      params.push(search, search);
    }

    const [countRows] = await query(`SELECT COUNT(*) AS total FROM vehicles v ${where}`, params);
    const total = countRows[0].total;

    const [rows] = await query(
      `SELECT v.id, v.matricula, v.alias, v.kilometros_actuales,
              v.fecha_matriculacion, v.fecha_itv, v.fecha_its,
              v.fecha_ultima_revision, v.fecha_ultimo_servicio,
              v.created_at, v.updated_at
       FROM vehicles v
       ${where}
       ORDER BY v.alias ASC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return paginated(res, { data: rows, total, page, limit });
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /vehicles/:id
// ============================================================
async function getVehicle(req, res, next) {
  try {
    const [rows] = await query(
      `SELECT id, matricula, alias, kilometros_actuales,
              fecha_matriculacion, fecha_itv, fecha_its,
              fecha_ultima_revision, fecha_ultimo_servicio, created_at, updated_at
       FROM vehicles WHERE id = ? AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!rows.length) return notFound(res, 'Vehículo');

    // Traer imágenes del vehículo (últimas por tipo)
    const [images] = await query(
      `SELECT id, tipo_imagen, image_url, trabajo_id, created_at
       FROM vehicle_images
       WHERE vehicle_id = ?
       ORDER BY created_at DESC`,
      [req.params.id]
    );

    return success(res, { ...rows[0], images });
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /vehicles  (admin o gestor)
// ============================================================
async function createVehicle(req, res, next) {
  try {
    const { matricula, alias, kilometros_actuales = 0,
            fecha_matriculacion, fecha_itv, fecha_its,
            fecha_ultima_revision, fecha_ultimo_servicio } = req.body;

    const [existing] = await query(
      'SELECT id FROM vehicles WHERE matricula = ? AND deleted_at IS NULL', [matricula]
    );
    if (existing.length) return error(res, 'Ya existe un vehículo con esa matrícula', 409);

    const [result] = await query(
      `INSERT INTO vehicles
         (matricula, alias, kilometros_actuales,
          fecha_matriculacion, fecha_itv, fecha_its,
          fecha_ultima_revision, fecha_ultimo_servicio)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [matricula.toUpperCase(), alias, kilometros_actuales,
       fecha_matriculacion || null, fecha_itv || null, fecha_its || null,
       fecha_ultima_revision || null, fecha_ultimo_servicio || null]
    );

    const [newVehicle] = await query('SELECT * FROM vehicles WHERE id = ?', [result.insertId]);
    return created(res, newVehicle[0], 'Vehículo creado');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// PUT /vehicles/:id  (admin o gestor)
// ============================================================
async function updateVehicle(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await query(
      'SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [id]
    );
    if (!existing.length) return notFound(res, 'Vehículo');

    const { alias, kilometros_actuales,
            fecha_matriculacion, fecha_itv, fecha_its,
            fecha_ultima_revision, fecha_ultimo_servicio } = req.body;

    const updates = [];
    const vals    = [];

    if (alias                  !== undefined) { updates.push('alias = ?');                  vals.push(alias); }
    if (kilometros_actuales    !== undefined) { updates.push('kilometros_actuales = ?');    vals.push(kilometros_actuales); }
    if (fecha_matriculacion    !== undefined) { updates.push('fecha_matriculacion = ?');    vals.push(fecha_matriculacion || null); }
    if (fecha_itv              !== undefined) { updates.push('fecha_itv = ?');              vals.push(fecha_itv || null); }
    if (fecha_its              !== undefined) { updates.push('fecha_its = ?');              vals.push(fecha_its || null); }
    if (fecha_ultima_revision  !== undefined) { updates.push('fecha_ultima_revision = ?');  vals.push(fecha_ultima_revision || null); }
    if (fecha_ultimo_servicio  !== undefined) { updates.push('fecha_ultimo_servicio = ?');  vals.push(fecha_ultimo_servicio || null); }

    if (!updates.length) return error(res, 'No hay campos para actualizar', 400);

    await query(`UPDATE vehicles SET ${updates.join(', ')} WHERE id = ?`, [...vals, id]);

    const [updated] = await query('SELECT * FROM vehicles WHERE id = ?', [id]);
    return success(res, updated[0], 'Vehículo actualizado');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// DELETE /vehicles/:id  (soft delete - solo admin)
// ============================================================
async function deleteVehicle(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await query(
      'SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [id]
    );
    if (!existing.length) return notFound(res, 'Vehículo');

    // Verificar que no esté asignado a trabajo activo
    const [activeJobs] = await query(
      `SELECT t.id FROM trabajo_vehiculos tv
       JOIN trabajos t ON tv.trabajo_id = t.id
       WHERE tv.vehicle_id = ? AND t.estado IN ('programado','activo') AND t.deleted_at IS NULL`,
      [id]
    );
    if (activeJobs.length) {
      return error(res, 'No se puede eliminar: el vehículo tiene trabajos activos asignados', 400);
    }

    await query('UPDATE vehicles SET deleted_at = NOW() WHERE id = ?', [id]);
    return success(res, null, 'Vehículo eliminado');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /vehicles/:id/images  - Subir imágenes al vehículo
// ============================================================
async function uploadImages(req, res, next) {
  try {
    const vehicleId = parseInt(req.params.id);
    const trabajoId = req.body.trabajo_id ? parseInt(req.body.trabajo_id) : null;
    const tipoImagen = req.body.tipo_imagen;

    const [veh] = await query(
      'SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicleId]
    );
    if (!veh.length) return notFound(res, 'Vehículo');

    if (!IMAGEN_TIPOS.includes(tipoImagen)) {
      return error(res, `tipo_imagen debe ser uno de: ${IMAGEN_TIPOS.join(', ')}`, 400);
    }

    if (!req.processedFile) {
      return error(res, 'No se recibió ninguna imagen', 400);
    }

    const [result] = await query(
      `INSERT INTO vehicle_images (vehicle_id, tipo_imagen, image_url, trabajo_id, uploaded_by)
       VALUES (?, ?, ?, ?, ?)`,
      [vehicleId, tipoImagen, req.processedFile.url, trabajoId, req.user.id]
    );

    return created(res, {
      id:          result.insertId,
      vehicle_id:  vehicleId,
      tipo_imagen: tipoImagen,
      image_url:   req.processedFile.url,
      trabajo_id:  trabajoId,
    }, 'Imagen subida correctamente');

  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /vehicles/:id/images
// ============================================================
async function getVehicleImages(req, res, next) {
  try {
    const vehicleId = parseInt(req.params.id);
    const trabajoId = req.query.trabajo_id ? parseInt(req.query.trabajo_id) : undefined;

    let sql    = 'SELECT * FROM vehicle_images WHERE vehicle_id = ?';
    const vals = [vehicleId];

    if (trabajoId !== undefined) {
      sql += ' AND trabajo_id = ?';
      vals.push(trabajoId);
    }

    sql += ' ORDER BY created_at DESC';

    const [rows] = await query(sql, vals);
    return success(res, rows);
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /vehicles/:id/historial
// Historial de trabajos con fotos, agrupado por trabajo.
// Solo accesible por administrador o gestor.
// ============================================================
async function getVehicleHistorial(req, res, next) {
  try {
    const vehicleId = parseInt(req.params.id);

    // Verificar que el vehículo existe
    const [vrow] = await query(
      'SELECT id, matricula, alias FROM vehicles WHERE id = ? AND deleted_at IS NULL',
      [vehicleId]
    );
    if (!vrow.length) return notFound(res, 'Vehículo');

    // Fotos con todo el contexto del trabajo y el usuario que subió
    const [rows] = await query(`
      SELECT
        vi.id,
        vi.tipo_imagen,
        vi.image_url,
        vi.created_at            AS foto_fecha,
        vi.trabajo_id,
        t.referencia             AS trabajo_referencia,
        t.fecha_inicio           AS trabajo_fecha_inicio,
        t.fecha_fin              AS trabajo_fecha_fin,
        t.estado                 AS trabajo_estado,
        tv_km.kilometros_fin     AS trabajo_km_fin,
        tv_km.kilometros_inicio  AS trabajo_km_inicio,
        u.id                     AS uploader_id,
        u.nombre                 AS uploader_nombre,
        u.apellidos              AS uploader_apellidos,
        u.username               AS uploader_username
      FROM vehicle_images vi
      LEFT JOIN trabajos t        ON vi.trabajo_id = t.id
      LEFT JOIN trabajo_vehiculos tv_km
                                  ON tv_km.trabajo_id = vi.trabajo_id
                                 AND tv_km.vehicle_id = vi.vehicle_id
      LEFT JOIN users u           ON vi.uploaded_by = u.id
      WHERE vi.vehicle_id = ?
      ORDER BY vi.trabajo_id DESC, vi.tipo_imagen ASC
    `, [vehicleId]);

    // Agrupar por trabajo
    const trabajosMap = new Map();
    for (const row of rows) {
      const tid = row.trabajo_id ?? 'sin_trabajo';
      if (!trabajosMap.has(tid)) {
        trabajosMap.set(tid, {
          trabajo_id:         row.trabajo_id,
          referencia:         row.trabajo_referencia,
          fecha_inicio:       row.trabajo_fecha_inicio,
          fecha_fin:          row.trabajo_fecha_fin,
          estado:             row.trabajo_estado,
          km_inicio:          row.trabajo_km_inicio,
          km_fin:             row.trabajo_km_fin,
          fotos:              [],
        });
      }
      trabajosMap.get(tid).fotos.push({
        id:          row.id,
        tipo_imagen: row.tipo_imagen,
        image_url:   row.image_url,
        fecha:       row.foto_fecha,
        subido_por: {
          id:       row.uploader_id,
          nombre:   row.uploader_nombre,
          apellidos: row.uploader_apellidos,
          username: row.uploader_username,
        },
      });
    }

    return success(res, {
      vehicle:  vrow[0],
      trabajos: [...trabajosMap.values()],
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listVehicles, getVehicle, createVehicle, updateVehicle,
  deleteVehicle, uploadImages, getVehicleImages, getVehicleHistorial,
};
