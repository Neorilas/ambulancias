/**
 * controllers/vehicles.controller.js
 * CRUD de vehículos + imágenes + incidencias + revisiones
 *
 * Control de acceso para operacionales:
 *   - Solo pueden ver/acceder a vehículos que tengan asignados en un trabajo
 *     con estado = 'activo' EN ESTE MOMENTO.
 *   - No pueden ver el estado de un vehículo aunque lo hayan usado antes
 *     o lo vayan a usar en el futuro.
 */

'use strict';

const { query, transaction }  = require('../config/database');
const { success, created, error, notFound, forbidden, paginated } = require('../utils/response.utils');
const { PAGINATION, IMAGEN_TIPOS } = require('../config/constants');
const { isAdmin, isOperacional }   = require('../middleware/roles.middleware');
const { deleteFile }               = require('../middleware/upload.middleware');

// ── Helper: ¿puede un operacional acceder a este vehículo? ────
async function canOperacionalAccess(userId, vehicleId) {
  const [rows] = await query(
    `SELECT tv.id
     FROM trabajo_vehiculos tv
     JOIN trabajos t         ON tv.trabajo_id = t.id
     JOIN trabajo_usuarios tu ON t.id = tu.trabajo_id
     WHERE tv.vehicle_id = ?
       AND tu.user_id    = ?
       AND t.estado      = 'activo'
       AND t.deleted_at  IS NULL`,
    [vehicleId, userId]
  );
  return rows.length > 0;
}

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

    // Operacionales: solo ven vehículos asignados en trabajo ACTIVO ahora mismo
    if (isOperacional(req.user)) {
      where += `
        AND EXISTS (
          SELECT 1 FROM trabajo_vehiculos tv
          JOIN trabajos t         ON tv.trabajo_id = t.id
          JOIN trabajo_usuarios tu ON t.id = tu.trabajo_id
          WHERE tv.vehicle_id = v.id
            AND tu.user_id    = ?
            AND t.estado      = 'activo'
            AND t.deleted_at  IS NULL
        )`;
      params.push(req.user.id);
    }

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
    const vehicleId = parseInt(req.params.id);

    if (isOperacional(req.user)) {
      const ok = await canOperacionalAccess(req.user.id, vehicleId);
      if (!ok) return forbidden(res, 'No tienes acceso a este vehículo');
    }

    const [rows] = await query(
      `SELECT id, matricula, alias, kilometros_actuales,
              fecha_matriculacion, fecha_itv, fecha_its,
              fecha_ultima_revision, fecha_ultimo_servicio, created_at, updated_at
       FROM vehicles WHERE id = ? AND deleted_at IS NULL`,
      [vehicleId]
    );
    if (!rows.length) return notFound(res, 'Vehículo');

    const [images] = await query(
      `SELECT id, tipo_imagen, image_url, trabajo_id, created_at
       FROM vehicle_images
       WHERE vehicle_id = ?
       ORDER BY created_at DESC`,
      [vehicleId]
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
// GET /vehicles/:id/images
// ============================================================
async function getVehicleImages(req, res, next) {
  try {
    const vehicleId = parseInt(req.params.id);

    if (isOperacional(req.user)) {
      const ok = await canOperacionalAccess(req.user.id, vehicleId);
      if (!ok) return forbidden(res, 'No tienes acceso a este vehículo');
    }

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
// GET /vehicles/:id/historial  (admin o gestor)
// ============================================================
async function getVehicleHistorial(req, res, next) {
  try {
    const vehicleId = parseInt(req.params.id);

    const [vrow] = await query(
      'SELECT id, matricula, alias, kilometros_actuales FROM vehicles WHERE id = ? AND deleted_at IS NULL',
      [vehicleId]
    );
    if (!vrow.length) return notFound(res, 'Vehículo');

    const [rows] = await query(`
      SELECT
        vi.id,
        vi.tipo_imagen,
        vi.image_url,
        vi.created_at               AS foto_fecha,
        vi.trabajo_id,
        t.identificador             AS trabajo_referencia,
        t.nombre                    AS trabajo_nombre,
        t.fecha_inicio              AS trabajo_fecha_inicio,
        t.fecha_fin                 AS trabajo_fecha_fin,
        t.estado                    AS trabajo_estado,
        tv_km.kilometros_fin        AS trabajo_km_fin,
        tv_km.kilometros_inicio     AS trabajo_km_inicio,
        tv_km.responsable_user_id,
        CONCAT(resp.nombre,' ',resp.apellidos) AS responsable_nombre,
        u.id                        AS uploader_id,
        u.nombre                    AS uploader_nombre,
        u.apellidos                 AS uploader_apellidos,
        u.username                  AS uploader_username
      FROM vehicle_images vi
      LEFT JOIN trabajos t           ON vi.trabajo_id = t.id
      LEFT JOIN trabajo_vehiculos tv_km
                                     ON tv_km.trabajo_id = vi.trabajo_id
                                    AND tv_km.vehicle_id  = vi.vehicle_id
      LEFT JOIN users resp           ON tv_km.responsable_user_id = resp.id
      LEFT JOIN users u              ON vi.uploaded_by = u.id
      WHERE vi.vehicle_id = ?
      ORDER BY vi.trabajo_id DESC, vi.tipo_imagen ASC
    `, [vehicleId]);

    const trabajosMap = new Map();
    for (const row of rows) {
      const tid = row.trabajo_id ?? 'sin_trabajo';
      if (!trabajosMap.has(tid)) {
        trabajosMap.set(tid, {
          trabajo_id:          row.trabajo_id,
          referencia:          row.trabajo_referencia,
          nombre:              row.trabajo_nombre,
          fecha_inicio:        row.trabajo_fecha_inicio,
          fecha_fin:           row.trabajo_fecha_fin,
          estado:              row.trabajo_estado,
          km_inicio:           row.trabajo_km_inicio,
          km_fin:              row.trabajo_km_fin,
          responsable_nombre:  row.responsable_nombre,
          responsable_user_id: row.responsable_user_id,
          fotos:               [],
        });
      }
      trabajosMap.get(tid).fotos.push({
        id:          row.id,
        tipo_imagen: row.tipo_imagen,
        image_url:   row.image_url,
        fecha:       row.foto_fecha,
        subido_por: {
          id:        row.uploader_id,
          nombre:    row.uploader_nombre,
          apellidos: row.uploader_apellidos,
          username:  row.uploader_username,
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

// ============================================================
// GET /vehicles/:id/incidencias  (admin o gestor)
// ============================================================
async function listIncidencias(req, res, next) {
  try {
    const vehicleId = parseInt(req.params.id);

    const [vrow] = await query(
      'SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicleId]
    );
    if (!vrow.length) return notFound(res, 'Vehículo');

    const [rows] = await query(`
      SELECT
        vi.id, vi.tipo, vi.gravedad, vi.descripcion, vi.estado,
        vi.created_at, vi.resuelto_at,
        vi.trabajo_id,
        t.identificador  AS trabajo_referencia,
        t.nombre         AS trabajo_nombre,
        rep.id           AS reporter_id,
        rep.nombre       AS reporter_nombre,
        rep.apellidos    AS reporter_apellidos,
        res.id           AS resolutor_id,
        res.nombre       AS resolutor_nombre,
        res.apellidos    AS resolutor_apellidos,
        -- responsable del vehículo en ese trabajo
        CONCAT(resp.nombre,' ',resp.apellidos) AS responsable_nombre,
        tv.responsable_user_id
      FROM vehicle_incidencias vi
      LEFT JOIN trabajos t          ON vi.trabajo_id = t.id
      LEFT JOIN trabajo_vehiculos tv ON vi.trabajo_id = tv.trabajo_id
                                    AND tv.vehicle_id = vi.vehicle_id
      LEFT JOIN users resp          ON tv.responsable_user_id = resp.id
      LEFT JOIN users rep           ON vi.reported_by  = rep.id
      LEFT JOIN users res           ON vi.resuelto_by  = res.id
      WHERE vi.vehicle_id = ?
      ORDER BY
        FIELD(vi.estado,'pendiente','en_revision','resuelto'),
        FIELD(vi.gravedad,'grave','moderado','leve'),
        vi.created_at DESC
    `, [vehicleId]);

    return success(res, rows.map(r => ({
      id:          r.id,
      tipo:        r.tipo,
      gravedad:    r.gravedad,
      descripcion: r.descripcion,
      estado:      r.estado,
      created_at:  r.created_at,
      resuelto_at: r.resuelto_at,
      trabajo: r.trabajo_id ? {
        id:         r.trabajo_id,
        referencia: r.trabajo_referencia,
        nombre:     r.trabajo_nombre,
        responsable_nombre:  r.responsable_nombre,
        responsable_user_id: r.responsable_user_id,
      } : null,
      reportado_por: { id: r.reporter_id, nombre: r.reporter_nombre, apellidos: r.reporter_apellidos },
      resuelto_por:  r.resolutor_id ? { id: r.resolutor_id, nombre: r.resolutor_nombre, apellidos: r.resolutor_apellidos } : null,
    })));
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /vehicles/:id/incidencias  (admin o gestor)
// ============================================================
async function createIncidencia(req, res, next) {
  try {
    const vehicleId = parseInt(req.params.id);
    const { tipo, gravedad, descripcion, trabajo_id } = req.body;

    if (!descripcion?.trim()) return error(res, 'Descripción requerida', 400);

    const [vrow] = await query(
      'SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicleId]
    );
    if (!vrow.length) return notFound(res, 'Vehículo');

    const [result] = await query(
      `INSERT INTO vehicle_incidencias
         (vehicle_id, trabajo_id, reported_by, tipo, gravedad, descripcion)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [vehicleId, trabajo_id || null, req.user.id,
       tipo || 'dano_exterior', gravedad || 'leve', descripcion.trim()]
    );

    const [created_row] = await query(
      'SELECT * FROM vehicle_incidencias WHERE id = ?', [result.insertId]
    );
    return created(res, created_row[0], 'Incidencia registrada');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// PATCH /vehicles/:vehicleId/incidencias/:incId  (admin o gestor)
// ============================================================
async function updateIncidencia(req, res, next) {
  try {
    const vehicleId = parseInt(req.params.vehicleId);
    const incId     = parseInt(req.params.incId);
    const { estado, descripcion, gravedad } = req.body;

    const [existing] = await query(
      'SELECT id, estado FROM vehicle_incidencias WHERE id = ? AND vehicle_id = ?',
      [incId, vehicleId]
    );
    if (!existing.length) return notFound(res, 'Incidencia');

    const updates = [];
    const vals    = [];

    if (descripcion !== undefined) { updates.push('descripcion = ?'); vals.push(descripcion.trim()); }
    if (gravedad    !== undefined) { updates.push('gravedad = ?');    vals.push(gravedad); }
    if (estado      !== undefined) {
      updates.push('estado = ?');
      vals.push(estado);
      if (estado === 'resuelto' && existing[0].estado !== 'resuelto') {
        updates.push('resuelto_by = ?', 'resuelto_at = NOW()');
        vals.push(req.user.id);
      }
    }

    if (!updates.length) return error(res, 'Sin campos para actualizar', 400);

    await query(
      `UPDATE vehicle_incidencias SET ${updates.join(', ')} WHERE id = ?`,
      [...vals, incId]
    );

    const [updated] = await query('SELECT * FROM vehicle_incidencias WHERE id = ?', [incId]);
    return success(res, updated[0], 'Incidencia actualizada');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /vehicles/:id/revisiones  (admin o gestor)
// ============================================================
async function listRevisiones(req, res, next) {
  try {
    const vehicleId = parseInt(req.params.id);

    const [vrow] = await query(
      'SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicleId]
    );
    if (!vrow.length) return notFound(res, 'Vehículo');

    const [rows] = await query(`
      SELECT vr.*, u.nombre AS creado_por_nombre, u.apellidos AS creado_por_apellidos
      FROM vehicle_revisiones vr
      JOIN users u ON vr.created_by = u.id
      WHERE vr.vehicle_id = ?
      ORDER BY vr.fecha_revision DESC
    `, [vehicleId]);

    return success(res, rows);
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /vehicles/:id/revisiones  (admin o gestor)
// ============================================================
async function createRevision(req, res, next) {
  try {
    const vehicleId = parseInt(req.params.id);
    const { tipo, fecha_revision, fecha_proxima, resultado, descripcion, coste, realizado_por } = req.body;

    if (!tipo || !fecha_revision) return error(res, 'tipo y fecha_revision son obligatorios', 400);

    const [vrow] = await query(
      'SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicleId]
    );
    if (!vrow.length) return notFound(res, 'Vehículo');

    const [result] = await query(
      `INSERT INTO vehicle_revisiones
         (vehicle_id, tipo, fecha_revision, fecha_proxima, resultado, descripcion, coste, realizado_por, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [vehicleId, tipo, fecha_revision, fecha_proxima || null,
       resultado || 'realizado', descripcion || null,
       coste || null, realizado_por || null, req.user.id]
    );

    // Si es ITV o ITS, actualizar la fecha en el vehículo
    if (tipo === 'itv') {
      await query('UPDATE vehicles SET fecha_itv = ? WHERE id = ?', [fecha_revision, vehicleId]);
    } else if (tipo === 'its') {
      await query('UPDATE vehicles SET fecha_its = ? WHERE id = ?', [fecha_revision, vehicleId]);
    } else if (['mantenimiento','revision_preventiva','reparacion'].includes(tipo)) {
      await query('UPDATE vehicles SET fecha_ultima_revision = ? WHERE id = ?', [fecha_revision, vehicleId]);
    }

    const [newRow] = await query(
      'SELECT vr.*, u.nombre AS creado_por_nombre FROM vehicle_revisiones vr JOIN users u ON vr.created_by = u.id WHERE vr.id = ?',
      [result.insertId]
    );
    return created(res, newRow[0], 'Revisión registrada');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// PUT /vehicles/:vehicleId/revisiones/:revId  (admin o gestor)
// ============================================================
async function updateRevision(req, res, next) {
  try {
    const vehicleId = parseInt(req.params.vehicleId);
    const revId     = parseInt(req.params.revId);

    const [existing] = await query(
      'SELECT id FROM vehicle_revisiones WHERE id = ? AND vehicle_id = ?',
      [revId, vehicleId]
    );
    if (!existing.length) return notFound(res, 'Revisión');

    const { tipo, fecha_revision, fecha_proxima, resultado, descripcion, coste, realizado_por } = req.body;
    const updates = [];
    const vals    = [];

    if (tipo           !== undefined) { updates.push('tipo = ?');            vals.push(tipo); }
    if (fecha_revision !== undefined) { updates.push('fecha_revision = ?');  vals.push(fecha_revision); }
    if (fecha_proxima  !== undefined) { updates.push('fecha_proxima = ?');   vals.push(fecha_proxima || null); }
    if (resultado      !== undefined) { updates.push('resultado = ?');       vals.push(resultado); }
    if (descripcion    !== undefined) { updates.push('descripcion = ?');     vals.push(descripcion || null); }
    if (coste          !== undefined) { updates.push('coste = ?');           vals.push(coste || null); }
    if (realizado_por  !== undefined) { updates.push('realizado_por = ?');   vals.push(realizado_por || null); }

    if (!updates.length) return error(res, 'Sin campos para actualizar', 400);

    await query(`UPDATE vehicle_revisiones SET ${updates.join(', ')} WHERE id = ?`, [...vals, revId]);

    const [updated] = await query(
      'SELECT vr.*, u.nombre AS creado_por_nombre FROM vehicle_revisiones vr JOIN users u ON vr.created_by = u.id WHERE vr.id = ?',
      [revId]
    );
    return success(res, updated[0], 'Revisión actualizada');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// DELETE /vehicles/:vehicleId/revisiones/:revId  (solo admin)
// ============================================================
async function deleteRevision(req, res, next) {
  try {
    const vehicleId = parseInt(req.params.vehicleId);
    const revId     = parseInt(req.params.revId);

    const [existing] = await query(
      'SELECT id FROM vehicle_revisiones WHERE id = ? AND vehicle_id = ?',
      [revId, vehicleId]
    );
    if (!existing.length) return notFound(res, 'Revisión');

    await query('DELETE FROM vehicle_revisiones WHERE id = ?', [revId]);
    return success(res, null, 'Revisión eliminada');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listVehicles, getVehicle, createVehicle, updateVehicle,
  deleteVehicle, uploadImages, getVehicleImages, getVehicleHistorial,
  listIncidencias, createIncidencia, updateIncidencia,
  listRevisiones,  createRevision,   updateRevision,  deleteRevision,
};
