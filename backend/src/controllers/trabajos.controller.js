/**
 * controllers/trabajos.controller.js
 * CRUD de trabajos + lógica de finalización con evidencias
 */

'use strict';

const { query, transaction }          = require('../config/database');
const { success, created, error, notFound, forbidden, paginated } =
  require('../utils/response.utils');
const { PAGINATION, TRABAJO_ESTADOS, TRABAJO_ID_PREFIX, IMAGEN_TIPOS_REQUERIDOS } =
  require('../config/constants');
const { isAdmin, isOperacional }      = require('../middleware/roles.middleware');
const logger                          = require('../utils/logger.utils');

// ============================================================
// Helpers
// ============================================================

/** Genera identificador único: TRB-2024-0001 */
async function generateIdentificador() {
  const year = new Date().getFullYear();
  const [rows] = await query(
    `SELECT identificador FROM trabajos
     WHERE identificador LIKE ? ORDER BY id DESC LIMIT 1`,
    [`${TRABAJO_ID_PREFIX}-${year}-%`]
  );
  let seq = 1;
  if (rows.length) {
    const last = rows[0].identificador.split('-').pop();
    seq = parseInt(last) + 1;
  }
  return `${TRABAJO_ID_PREFIX}-${year}-${String(seq).padStart(4, '0')}`;
}

/** Obtiene trabajo completo con relaciones */
async function getTrabajoCompleto(id) {
  const [trows] = await query(
    `SELECT t.*, u.nombre AS creado_por_nombre, u.apellidos AS creado_por_apellidos
     FROM trabajos t
     JOIN users u ON t.created_by = u.id
     WHERE t.id = ? AND t.deleted_at IS NULL`,
    [id]
  );
  if (!trows.length) return null;

  const t = trows[0];

  // Vehículos asignados
  const [vehicles] = await query(
    `SELECT tv.id AS asignacion_id, tv.vehicle_id, tv.responsable_user_id,
            tv.kilometros_inicio, tv.kilometros_fin,
            v.matricula, v.alias,
            CONCAT(u.nombre,' ',u.apellidos) AS responsable_nombre
     FROM trabajo_vehiculos tv
     JOIN vehicles v ON tv.vehicle_id = v.id
     JOIN users u ON tv.responsable_user_id = u.id
     WHERE tv.trabajo_id = ?`,
    [id]
  );

  // Personal asignado
  const [usuarios] = await query(
    `SELECT tu.user_id, u.username, u.nombre, u.apellidos,
            GROUP_CONCAT(r.nombre SEPARATOR ',') AS roles
     FROM trabajo_usuarios tu
     JOIN users u ON tu.user_id = u.id
     LEFT JOIN user_roles ur ON u.id = ur.user_id
     LEFT JOIN roles r ON ur.role_id = r.id
     WHERE tu.trabajo_id = ?
     GROUP BY tu.user_id`,
    [id]
  );

  // Imágenes de evidencia
  const [images] = await query(
    `SELECT vi.id, vi.vehicle_id, vi.tipo_imagen, vi.image_url, vi.created_at,
            v.matricula
     FROM vehicle_images vi
     JOIN vehicles v ON vi.vehicle_id = v.id
     WHERE vi.trabajo_id = ?
     ORDER BY vi.created_at ASC`,
    [id]
  );

  return {
    ...t,
    vehiculos: vehicles,
    usuarios:  usuarios.map(u => ({ ...u, roles: u.roles ? u.roles.split(',') : [] })),
    evidencias: images,
  };
}

// ============================================================
// GET /trabajos
// ============================================================
async function listTrabajos(req, res, next) {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || PAGINATION.DEFAULT_PAGE);
    const limit  = Math.min(parseInt(req.query.limit) || PAGINATION.DEFAULT_LIMIT, PAGINATION.MAX_LIMIT);
    const offset = (page - 1) * limit;

    const { estado, tipo, fecha_desde, fecha_hasta, search } = req.query;

    let where  = 'WHERE t.deleted_at IS NULL';
    const params = [];

    // Filtro por rol: operacionales solo ven sus trabajos
    if (isOperacional(req.user)) {
      where += ' AND EXISTS (SELECT 1 FROM trabajo_usuarios tu WHERE tu.trabajo_id = t.id AND tu.user_id = ?)';
      params.push(req.user.id);
    }

    if (estado) { where += ' AND t.estado = ?';       params.push(estado); }
    if (tipo)   { where += ' AND t.tipo = ?';         params.push(tipo); }
    if (fecha_desde) { where += ' AND t.fecha_inicio >= ?'; params.push(fecha_desde); }
    if (fecha_hasta) { where += ' AND t.fecha_fin <= ?';    params.push(fecha_hasta + ' 23:59:59'); }
    if (search) {
      where += ' AND (t.nombre LIKE ? OR t.identificador LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const [countRows] = await query(
      `SELECT COUNT(*) AS total FROM trabajos t ${where}`, params
    );
    const total = countRows[0].total;

    const [rows] = await query(
      `SELECT t.id, t.identificador, t.nombre, t.tipo, t.estado,
              t.fecha_inicio, t.fecha_fin, t.created_at,
              u.nombre AS creado_por_nombre, u.apellidos AS creado_por_apellidos,
              COUNT(DISTINCT tv.vehicle_id) AS num_vehiculos,
              COUNT(DISTINCT tu.user_id) AS num_usuarios
       FROM trabajos t
       JOIN users u ON t.created_by = u.id
       LEFT JOIN trabajo_vehiculos tv ON t.id = tv.trabajo_id
       LEFT JOIN trabajo_usuarios tu ON t.id = tu.trabajo_id
       ${where}
       GROUP BY t.id
       ORDER BY t.fecha_inicio DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return paginated(res, { data: rows, total, page, limit });
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /trabajos/calendario  (para vista agenda)
// ============================================================
async function listTrabajosCalendario(req, res, next) {
  try {
    const { year, month } = req.query;
    const y = parseInt(year)  || new Date().getFullYear();
    const m = parseInt(month) || new Date().getMonth() + 1;

    const desde = `${y}-${String(m).padStart(2,'0')}-01 00:00:00`;
    // Primer día del mes siguiente
    const mSig = m === 12 ? 1 : m + 1;
    const ySig = m === 12 ? y + 1 : y;
    const hasta = `${ySig}-${String(mSig).padStart(2,'0')}-01 00:00:00`;

    let sql    = `SELECT t.id, t.identificador, t.nombre, t.tipo, t.estado,
                         t.fecha_inicio, t.fecha_fin
                  FROM trabajos t
                  WHERE t.deleted_at IS NULL
                    AND t.fecha_inicio < ? AND t.fecha_fin >= ?`;
    const params = [hasta, desde];

    if (isOperacional(req.user)) {
      sql += ' AND EXISTS (SELECT 1 FROM trabajo_usuarios tu WHERE tu.trabajo_id = t.id AND tu.user_id = ?)';
      params.push(req.user.id);
    }

    sql += ' ORDER BY t.fecha_inicio ASC';

    const [rows] = await query(sql, params);
    return success(res, rows);
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /trabajos/:id
// ============================================================
async function getTrabajo(req, res, next) {
  try {
    const t = await getTrabajoCompleto(parseInt(req.params.id));
    if (!t) return notFound(res, 'Trabajo');

    // Operacional solo puede ver trabajos donde está asignado
    if (isOperacional(req.user)) {
      const asignado = t.usuarios.some(u => u.user_id === req.user.id);
      if (!asignado) return forbidden(res, 'No tienes acceso a este trabajo');
    }

    return success(res, t);
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /trabajos  (admin o gestor)
// ============================================================
async function createTrabajo(req, res, next) {
  try {
    const { nombre, tipo, fecha_inicio, fecha_fin, vehiculos = [], usuarios = [] } = req.body;

    if (new Date(fecha_fin) <= new Date(fecha_inicio)) {
      return error(res, 'fecha_fin debe ser posterior a fecha_inicio', 400);
    }

    const identificador = await generateIdentificador();

    const trabajoId = await transaction(async (conn) => {
      const [result] = await conn.execute(
        `INSERT INTO trabajos (identificador, nombre, tipo, fecha_inicio, fecha_fin, created_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [identificador, nombre, tipo, fecha_inicio, fecha_fin, req.user.id]
      );
      const newId = result.insertId;

      // Asignar vehículos
      for (const veh of vehiculos) {
        await conn.execute(
          `INSERT INTO trabajo_vehiculos (trabajo_id, vehicle_id, responsable_user_id, kilometros_inicio)
           VALUES (?, ?, ?, ?)`,
          [newId, veh.vehicle_id, veh.responsable_user_id, veh.kilometros_inicio || null]
        );
        // Actualizar km del vehículo si se proporcionan
        if (veh.kilometros_inicio) {
          await conn.execute(
            'UPDATE vehicles SET kilometros_actuales = ? WHERE id = ? AND kilometros_actuales < ?',
            [veh.kilometros_inicio, veh.vehicle_id, veh.kilometros_inicio]
          );
        }
      }

      // Asignar usuarios
      for (const userId of usuarios) {
        await conn.execute(
          'INSERT IGNORE INTO trabajo_usuarios (trabajo_id, user_id) VALUES (?, ?)',
          [newId, userId]
        );
      }

      return newId;
    });

    const t = await getTrabajoCompleto(trabajoId);
    return created(res, t, 'Trabajo creado');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// PUT /trabajos/:id  (admin o gestor)
// ============================================================
async function updateTrabajo(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await query(
      'SELECT id, estado FROM trabajos WHERE id = ? AND deleted_at IS NULL', [id]
    );
    if (!existing.length) return notFound(res, 'Trabajo');

    const est = existing[0].estado;
    if ([TRABAJO_ESTADOS.FINALIZADO, TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO].includes(est)) {
      return error(res, 'No se puede modificar un trabajo finalizado', 400);
    }

    const { nombre, tipo, fecha_inicio, fecha_fin, estado, vehiculos, usuarios } = req.body;

    await transaction(async (conn) => {
      const updates = [];
      const vals    = [];
      if (nombre       !== undefined) { updates.push('nombre = ?');       vals.push(nombre); }
      if (tipo         !== undefined) { updates.push('tipo = ?');         vals.push(tipo); }
      if (fecha_inicio !== undefined) { updates.push('fecha_inicio = ?'); vals.push(fecha_inicio); }
      if (fecha_fin    !== undefined) { updates.push('fecha_fin = ?');    vals.push(fecha_fin); }
      if (estado       !== undefined && [TRABAJO_ESTADOS.PROGRAMADO, TRABAJO_ESTADOS.ACTIVO].includes(estado)) {
        updates.push('estado = ?'); vals.push(estado);
      }

      if (updates.length) {
        await conn.execute(`UPDATE trabajos SET ${updates.join(', ')} WHERE id = ?`, [...vals, id]);
      }

      if (vehiculos !== undefined) {
        await conn.execute('DELETE FROM trabajo_vehiculos WHERE trabajo_id = ?', [id]);
        for (const veh of vehiculos) {
          await conn.execute(
            `INSERT INTO trabajo_vehiculos (trabajo_id, vehicle_id, responsable_user_id, kilometros_inicio)
             VALUES (?, ?, ?, ?)`,
            [id, veh.vehicle_id, veh.responsable_user_id, veh.kilometros_inicio || null]
          );
        }
      }

      if (usuarios !== undefined) {
        await conn.execute('DELETE FROM trabajo_usuarios WHERE trabajo_id = ?', [id]);
        for (const userId of usuarios) {
          await conn.execute(
            'INSERT IGNORE INTO trabajo_usuarios (trabajo_id, user_id) VALUES (?, ?)',
            [id, userId]
          );
        }
      }
    });

    const t = await getTrabajoCompleto(id);
    return success(res, t, 'Trabajo actualizado');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// DELETE /trabajos/:id  (soft delete - admin o gestor)
// ============================================================
async function deleteTrabajo(req, res, next) {
  try {
    const id = parseInt(req.params.id);
    const [existing] = await query(
      'SELECT id, estado FROM trabajos WHERE id = ? AND deleted_at IS NULL', [id]
    );
    if (!existing.length) return notFound(res, 'Trabajo');

    if (existing[0].estado === TRABAJO_ESTADOS.ACTIVO) {
      return error(res, 'No se puede eliminar un trabajo activo', 400);
    }

    await query('UPDATE trabajos SET deleted_at = NOW() WHERE id = ?', [id]);
    return success(res, null, 'Trabajo eliminado');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /trabajos/:id/finalize
// Finalización con evidencias obligatorias
// ============================================================
async function finalizeTrabajo(req, res, next) {
  try {
    const id = parseInt(req.params.id);

    const [existing] = await query(
      `SELECT t.*, tv.vehicle_id, tv.responsable_user_id
       FROM trabajos t
       LEFT JOIN trabajo_vehiculos tv ON t.id = tv.trabajo_id
       WHERE t.id = ? AND t.deleted_at IS NULL`,
      [id]
    );
    if (!existing.length) return notFound(res, 'Trabajo');

    const trabajo = existing[0];

    // Verificar que quien finaliza es responsable o admin/gestor
    if (isOperacional(req.user)) {
      const esResponsable = existing.some(row => row.responsable_user_id === req.user.id);
      if (!esResponsable) return forbidden(res, 'Solo el responsable puede finalizar este trabajo');
    }

    if ([TRABAJO_ESTADOS.FINALIZADO, TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO].includes(trabajo.estado)) {
      return error(res, 'El trabajo ya está finalizado', 400);
    }

    const { motivo_finalizacion_anticipada, vehiculos_km = [] } = req.body;
    const isAnticipado = new Date() < new Date(trabajo.fecha_fin);

    if (isAnticipado && !motivo_finalizacion_anticipada?.trim()) {
      return error(res, 'Es obligatorio indicar el motivo de finalización anticipada', 400);
    }

    // Verificar evidencias: 5 fotos por cada vehículo asignado
    const vehicleIds = [...new Set(existing.map(r => r.vehicle_id).filter(Boolean))];
    for (const vehicleId of vehicleIds) {
      const [imgs] = await query(
        `SELECT tipo_imagen FROM vehicle_images
         WHERE vehicle_id = ? AND trabajo_id = ?`,
        [vehicleId, id]
      );
      const tiposSubidos = imgs.map(i => i.tipo_imagen);
      const faltantes = IMAGEN_TIPOS_REQUERIDOS.filter(t => !tiposSubidos.includes(t));
      if (faltantes.length > 0) {
        return error(res,
          `Faltan evidencias del vehículo ${vehicleId}: ${faltantes.join(', ')}`, 400
        );
      }
    }

    // Verificar que se proporcionaron km finales para cada vehículo
    for (const vehicleId of vehicleIds) {
      const kmData = vehiculos_km.find(v => v.vehicle_id === vehicleId);
      if (!kmData?.kilometros_fin) {
        return error(res, `Faltan kilómetros finales para el vehículo ${vehicleId}`, 400);
      }
    }

    await transaction(async (conn) => {
      const nuevoEstado = isAnticipado
        ? TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO
        : TRABAJO_ESTADOS.FINALIZADO;

      await conn.execute(
        `UPDATE trabajos SET estado = ?, motivo_finalizacion_anticipada = ? WHERE id = ?`,
        [nuevoEstado, motivo_finalizacion_anticipada || null, id]
      );

      // Actualizar km finales de vehículos
      for (const vkm of vehiculos_km) {
        await conn.execute(
          `UPDATE trabajo_vehiculos SET kilometros_fin = ? WHERE trabajo_id = ? AND vehicle_id = ?`,
          [vkm.kilometros_fin, id, vkm.vehicle_id]
        );
        // Actualizar km actuales del vehículo
        await conn.execute(
          `UPDATE vehicles SET kilometros_actuales = ?,
                               fecha_ultimo_servicio = CURDATE()
           WHERE id = ? AND kilometros_actuales < ?`,
          [vkm.kilometros_fin, vkm.vehicle_id, vkm.kilometros_fin]
        );
      }
    });

    const t = await getTrabajoCompleto(id);
    return success(res, t, 'Trabajo finalizado correctamente');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /trabajos/:id/evidencias
// Subida de evidencias (imágenes) para un trabajo
// ============================================================
async function uploadEvidencia(req, res, next) {
  try {
    const trabajoId = parseInt(req.params.id);
    const vehicleId = parseInt(req.body.vehicle_id);
    const tipoImagen = req.body.tipo_imagen;

    if (!vehicleId || isNaN(vehicleId)) {
      return error(res, 'vehicle_id requerido', 400);
    }
    if (!IMAGEN_TIPOS_REQUERIDOS.includes(tipoImagen)) {
      return error(res, `tipo_imagen debe ser uno de: ${IMAGEN_TIPOS_REQUERIDOS.join(', ')}`, 400);
    }

    const [trow] = await query(
      'SELECT id, estado FROM trabajos WHERE id = ? AND deleted_at IS NULL', [trabajoId]
    );
    if (!trow.length) return notFound(res, 'Trabajo');

    if ([TRABAJO_ESTADOS.FINALIZADO, TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO].includes(trow[0].estado)) {
      return error(res, 'No se pueden subir evidencias a un trabajo ya finalizado', 400);
    }

    // Verificar que el vehículo está asignado al trabajo
    const [assigned] = await query(
      'SELECT id FROM trabajo_vehiculos WHERE trabajo_id = ? AND vehicle_id = ?',
      [trabajoId, vehicleId]
    );
    if (!assigned.length) return error(res, 'El vehículo no está asignado a este trabajo', 400);

    if (!req.processedFile) return error(res, 'No se recibió ninguna imagen', 400);

    // Si ya existe una imagen de ese tipo para este trabajo+vehículo, sobreescribir
    const [existing] = await query(
      'SELECT id, image_url FROM vehicle_images WHERE vehicle_id = ? AND trabajo_id = ? AND tipo_imagen = ?',
      [vehicleId, trabajoId, tipoImagen]
    );

    let imageId;
    if (existing.length) {
      // Eliminar archivo viejo
      const { deleteFile } = require('../middleware/upload.middleware');
      deleteFile(existing[0].image_url);

      await query(
        'UPDATE vehicle_images SET image_url = ?, uploaded_by = ? WHERE id = ?',
        [req.processedFile.url, req.user.id, existing[0].id]
      );
      imageId = existing[0].id;
    } else {
      const [result] = await query(
        `INSERT INTO vehicle_images (vehicle_id, tipo_imagen, image_url, trabajo_id, uploaded_by)
         VALUES (?, ?, ?, ?, ?)`,
        [vehicleId, tipoImagen, req.processedFile.url, trabajoId, req.user.id]
      );
      imageId = result.insertId;
    }

    // Calcular progreso: cuántas fotos faltan para este vehículo en este trabajo
    const [progress] = await query(
      'SELECT tipo_imagen FROM vehicle_images WHERE vehicle_id = ? AND trabajo_id = ?',
      [vehicleId, trabajoId]
    );
    const tiposSubidos = progress.map(p => p.tipo_imagen);
    const faltantes    = IMAGEN_TIPOS_REQUERIDOS.filter(t => !tiposSubidos.includes(t));

    return created(res, {
      id:          imageId,
      image_url:   req.processedFile.url,
      tipo_imagen: tipoImagen,
      vehicle_id:  vehicleId,
      trabajo_id:  trabajoId,
      progreso: {
        completado: tiposSubidos.length,
        total:      IMAGEN_TIPOS_REQUERIDOS.length,
        faltantes,
        completo:   faltantes.length === 0,
      },
    }, 'Evidencia subida correctamente');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /trabajos/mis-trabajos  (para operacionales)
// ============================================================
async function misTrab(req, res, next) {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || 1);
    const limit  = 20;
    const offset = (page - 1) * limit;

    const [countRows] = await query(
      `SELECT COUNT(*) AS total FROM trabajo_usuarios tu
       JOIN trabajos t ON tu.trabajo_id = t.id
       WHERE tu.user_id = ? AND t.deleted_at IS NULL`,
      [req.user.id]
    );

    const [rows] = await query(
      `SELECT t.id, t.identificador, t.nombre, t.tipo, t.estado,
              t.fecha_inicio, t.fecha_fin,
              v.matricula, v.alias AS vehiculo_alias,
              CONCAT(resp.nombre,' ',resp.apellidos) AS responsable,
              tv.responsable_user_id = ? AS soy_responsable
       FROM trabajo_usuarios tu
       JOIN trabajos t ON tu.trabajo_id = t.id
       LEFT JOIN trabajo_vehiculos tv ON t.id = tv.trabajo_id
       LEFT JOIN vehicles v ON tv.vehicle_id = v.id
       LEFT JOIN users resp ON tv.responsable_user_id = resp.id
       WHERE tu.user_id = ? AND t.deleted_at IS NULL
       ORDER BY t.fecha_inicio DESC
       LIMIT ? OFFSET ?`,
      [req.user.id, req.user.id, limit, offset]
    );

    return paginated(res, { data: rows, total: countRows[0].total, page, limit });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listTrabajos, listTrabajosCalendario, getTrabajo,
  createTrabajo, updateTrabajo, deleteTrabajo,
  finalizeTrabajo, uploadEvidencia, misTrab,
};
