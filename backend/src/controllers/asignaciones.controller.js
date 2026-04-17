/**
 * controllers/asignaciones.controller.js
 * CRUD de asignaciones libres de vehículo + flujo de finalización con evidencias
 */

'use strict';

const { query, transaction }    = require('../config/database');
const { success, created, error, notFound, forbidden, paginated } =
  require('../utils/response.utils');
const { PAGINATION, IMAGEN_TIPOS, IMAGEN_TIPOS_INICIO, IMAGEN_TIPOS_FIN, PERMISSIONS } =
  require('../config/constants');
const { hasPermission, isAdmin } = require('../middleware/roles.middleware');
const logger                     = require('../utils/logger.utils');
const { deleteFile }             = require('../middleware/upload.middleware');

// ============================================================
// Helper: progreso de evidencias (inicio y fin) de una asignación
// ============================================================
async function getProgreso(asignacionId) {
  const [rows] = await query(
    `SELECT tipo_imagen, momento FROM vehicle_images WHERE asignacion_id = ?`,
    [asignacionId]
  );
  const inicioSubidos = rows.filter(r => r.momento === 'inicio').map(r => r.tipo_imagen);
  const finSubidos    = rows.filter(r => r.momento === 'fin').map(r => r.tipo_imagen);

  const inicio = {
    completado: inicioSubidos.length,
    total:      IMAGEN_TIPOS_INICIO.length,
    faltantes:  IMAGEN_TIPOS_INICIO.filter(t => !inicioSubidos.includes(t)),
    completo:   IMAGEN_TIPOS_INICIO.every(t => inicioSubidos.includes(t)),
  };
  const fin = {
    completado: finSubidos.length,
    total:      IMAGEN_TIPOS_FIN.length,
    faltantes:  IMAGEN_TIPOS_FIN.filter(t => !finSubidos.includes(t)),
    completo:   IMAGEN_TIPOS_FIN.every(t => finSubidos.includes(t)),
  };
  return { inicio, fin };
}

// Helper: obtener asignación completa con relaciones
async function getAsignacionCompleta(id) {
  const [rows] = await query(
    `SELECT al.*,
            v.matricula, v.alias AS vehiculo_alias,
            CONCAT(u.nombre,' ',u.apellidos) AS responsable_nombre,
            u.username AS responsable_username,
            CONCAT(c.nombre,' ',c.apellidos) AS creado_por_nombre
     FROM asignaciones_libres al
     JOIN vehicles v ON al.vehicle_id = v.id
     JOIN users u    ON al.user_id    = u.id
     JOIN users c    ON al.created_by = c.id
     WHERE al.id = ? AND al.deleted_at IS NULL`,
    [id]
  );
  if (!rows.length) return null;

  const asig = rows[0];

  // Evidencias subidas
  const [evidencias] = await query(
    `SELECT id, tipo_imagen, momento, image_url, created_at AS uploaded_at
     FROM vehicle_images
     WHERE asignacion_id = ?
     ORDER BY FIELD(momento,'inicio','fin','general'), created_at ASC`,
    [id]
  );

  asig.evidencias = evidencias;
  asig.progreso   = await getProgreso(id);

  return asig;
}

// ============================================================
// GET /asignaciones
// ============================================================
async function listAsignaciones(req, res, next) {
  try {
    const canManage = hasPermission(req.user, PERMISSIONS.MANAGE_TRABAJOS);
    const page   = Math.max(1, parseInt(req.query.page)  || PAGINATION.DEFAULT_PAGE);
    const limit  = Math.min(parseInt(req.query.limit) || PAGINATION.DEFAULT_LIMIT, PAGINATION.MAX_LIMIT);
    const offset = (page - 1) * limit;
    const estado = req.query.estado || null;

    const whereParts = ['al.deleted_at IS NULL'];
    const params     = [];

    // Operacionales solo ven las suyas
    if (!canManage) {
      whereParts.push('al.user_id = ?');
      params.push(req.user.id);
    }

    if (estado) {
      whereParts.push('al.estado = ?');
      params.push(estado);
    }

    const where = 'WHERE ' + whereParts.join(' AND ');

    const [countRows] = await query(
      `SELECT COUNT(*) AS total FROM asignaciones_libres al ${where}`,
      params
    );
    const total = countRows[0].total;

    const [rows] = await query(
      `SELECT al.id, al.vehicle_id, al.user_id, al.fecha_inicio, al.fecha_fin,
              al.estado, al.km_inicio, al.km_fin, al.notas, al.created_at,
              v.matricula, v.alias AS vehiculo_alias,
              CONCAT(u.nombre,' ',u.apellidos) AS responsable_nombre,
              u.username AS responsable_username
       FROM asignaciones_libres al
       JOIN vehicles v ON al.vehicle_id = v.id
       JOIN users u    ON al.user_id    = u.id
       ${where}
       ORDER BY al.fecha_inicio DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return paginated(res, { data: rows, total, page, limit });
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /asignaciones/:id
// ============================================================
async function getAsignacion(req, res, next) {
  try {
    const canManage = hasPermission(req.user, PERMISSIONS.MANAGE_TRABAJOS);
    const asig = await getAsignacionCompleta(req.params.id);

    if (!asig) return notFound(res, 'Asignación');

    // Operacionales solo pueden ver las suyas
    if (!canManage && asig.user_id !== req.user.id) {
      return forbidden(res, 'No tienes acceso a esta asignación');
    }

    return success(res, asig);
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /asignaciones
// ============================================================
async function createAsignacion(req, res, next) {
  try {
    const { vehicle_id, user_id, fecha_inicio, fecha_fin, km_inicio, notas } = req.body;

    // Validar que vehículo existe
    const [veh] = await query('SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicle_id]);
    if (!veh.length) return notFound(res, 'Vehículo');

    // Validar que usuario existe
    const [usr] = await query('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL AND activo = 1', [user_id]);
    if (!usr.length) return notFound(res, 'Usuario');

    // Validar fechas
    if (new Date(fecha_fin) <= new Date(fecha_inicio)) {
      return error(res, 'fecha_fin debe ser posterior a fecha_inicio', 400);
    }

    const [result] = await query(
      `INSERT INTO asignaciones_libres
         (vehicle_id, user_id, created_by, fecha_inicio, fecha_fin, km_inicio, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [vehicle_id, user_id, req.user.id, fecha_inicio, fecha_fin, km_inicio || null, notas || null]
    );

    const asig = await getAsignacionCompleta(result.insertId);
    return created(res, asig, 'Asignación creada correctamente');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// PUT /asignaciones/:id
// ============================================================
async function updateAsignacion(req, res, next) {
  try {
    const asig = await getAsignacionCompleta(req.params.id);
    if (!asig) return notFound(res, 'Asignación');

    if (asig.estado === 'finalizada' || asig.estado === 'cancelada') {
      return error(res, `No se puede editar una asignación en estado "${asig.estado}"`, 400);
    }

    const { vehicle_id, user_id, fecha_inicio, fecha_fin, km_inicio, notas, estado } = req.body;

    // Validar solo si se cambian
    if (vehicle_id) {
      const [veh] = await query('SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL', [vehicle_id]);
      if (!veh.length) return notFound(res, 'Vehículo');
    }
    if (user_id) {
      const [usr] = await query('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL AND activo = 1', [user_id]);
      if (!usr.length) return notFound(res, 'Usuario');
    }

    // Solo pueden cambiar a programada/activa/cancelada mediante update
    const estadosPermitidos = ['programada', 'activa', 'cancelada'];
    if (estado && !estadosPermitidos.includes(estado)) {
      return error(res, `estado inválido. Usa el endpoint /activar o /finalizar`, 400);
    }

    await query(
      `UPDATE asignaciones_libres SET
         vehicle_id   = COALESCE(?, vehicle_id),
         user_id      = COALESCE(?, user_id),
         fecha_inicio = COALESCE(?, fecha_inicio),
         fecha_fin    = COALESCE(?, fecha_fin),
         km_inicio    = COALESCE(?, km_inicio),
         notas        = COALESCE(?, notas),
         estado       = COALESCE(?, estado)
       WHERE id = ?`,
      [
        vehicle_id   || null,
        user_id      || null,
        fecha_inicio || null,
        fecha_fin    || null,
        km_inicio    !== undefined ? km_inicio : null,
        notas        !== undefined ? notas : null,
        estado       || null,
        asig.id,
      ]
    );

    const updated = await getAsignacionCompleta(asig.id);
    return success(res, updated, 'Asignación actualizada');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// DELETE /asignaciones/:id
// ============================================================
async function deleteAsignacion(req, res, next) {
  try {
    const [rows] = await query(
      'SELECT id, estado FROM asignaciones_libres WHERE id = ? AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!rows.length) return notFound(res, 'Asignación');

    await query(
      'UPDATE asignaciones_libres SET deleted_at = NOW() WHERE id = ?',
      [rows[0].id]
    );

    return success(res, null, 'Asignación eliminada');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /asignaciones/:id/activar
// ============================================================
async function activarAsignacion(req, res, next) {
  try {
    const canManage = hasPermission(req.user, PERMISSIONS.MANAGE_TRABAJOS);
    const asig = await getAsignacionCompleta(req.params.id);
    if (!asig) return notFound(res, 'Asignación');

    // Solo el responsable o admin/gestor pueden activar
    if (!canManage && asig.user_id !== req.user.id) {
      return forbidden(res, 'Solo el responsable puede activar esta asignación');
    }

    if (asig.estado !== 'programada') {
      return error(res, `Solo se puede activar una asignación programada (estado actual: ${asig.estado})`, 400);
    }

    await query(
      'UPDATE asignaciones_libres SET estado = ? WHERE id = ?',
      ['activa', asig.id]
    );

    const updated = await getAsignacionCompleta(asig.id);
    return success(res, updated, 'Asignación activada');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /asignaciones/:id/finalizar
// ============================================================
async function finalizarAsignacion(req, res, next) {
  try {
    const canManage = hasPermission(req.user, PERMISSIONS.MANAGE_TRABAJOS);
    const asig = await getAsignacionCompleta(req.params.id);
    if (!asig) return notFound(res, 'Asignación');

    // Solo el responsable o admin/gestor pueden finalizar
    if (!canManage && asig.user_id !== req.user.id) {
      return forbidden(res, 'Solo el responsable puede finalizar esta asignación');
    }

    if (asig.estado === 'finalizada') {
      return error(res, 'La asignación ya está finalizada', 400);
    }
    if (asig.estado === 'cancelada') {
      return error(res, 'No se puede finalizar una asignación cancelada', 400);
    }

    const { km_fin, motivo_fin } = req.body;

    // Si es anticipada (ahora < fecha_fin), el motivo es obligatorio
    const esAnticipada = new Date() < new Date(asig.fecha_fin);
    if (esAnticipada && (!motivo_fin || !motivo_fin.trim())) {
      return error(res, 'motivo_fin es obligatorio cuando la finalización es anticipada', 400);
    }

    // Validar que km_fin >= km_inicio (si se proporcionan ambos)
    if (km_fin !== undefined && asig.km_inicio !== null && km_fin < asig.km_inicio) {
      return error(res, 'km_fin no puede ser menor que km_inicio', 400);
    }

    // Validar que todas las evidencias (inicio y fin) están subidas
    const progreso = await getProgreso(asig.id);
    if (!progreso.inicio.completo) {
      return error(
        res,
        `No se puede finalizar: faltan fotos de INICIO (${progreso.inicio.faltantes.join(', ')}). Sube primero las fotos de inicio.`,
        400
      );
    }
    if (!progreso.fin.completo) {
      return error(
        res,
        `Faltan fotos de FIN: ${progreso.fin.faltantes.join(', ')}`,
        400
      );
    }

    await query(
      `UPDATE asignaciones_libres SET
         estado         = 'finalizada',
         km_fin         = ?,
         motivo_fin     = ?,
         finalizado_por = ?,
         finalizado_at  = NOW()
       WHERE id = ?`,
      [km_fin || null, motivo_fin || null, req.user.id, asig.id]
    );

    const updated = await getAsignacionCompleta(asig.id);
    return success(res, updated, 'Asignación finalizada correctamente');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /asignaciones/:id/evidencias
// ============================================================
async function uploadEvidencia(req, res, next) {
  try {
    const canManage = hasPermission(req.user, PERMISSIONS.MANAGE_TRABAJOS);
    const asig = await getAsignacionCompleta(req.params.id);
    if (!asig) return notFound(res, 'Asignación');

    // Solo el responsable o admin/gestor pueden subir evidencias
    if (!canManage && asig.user_id !== req.user.id) {
      return forbidden(res, 'No puedes subir evidencias de esta asignación');
    }

    if (asig.estado === 'finalizada') {
      return error(res, 'No se pueden subir evidencias a una asignación ya finalizada', 400);
    }

    if (!req.processedFile) {
      return error(res, 'No se ha recibido ninguna imagen', 400);
    }

    const { tipo_imagen } = req.body;
    const momento = req.body.momento || 'fin';
    const imageUrl = req.processedFile.url;

    if (!['inicio', 'fin'].includes(momento)) {
      return error(res, 'momento debe ser "inicio" o "fin"', 400);
    }
    const listaValida = momento === 'inicio' ? IMAGEN_TIPOS_INICIO : IMAGEN_TIPOS_FIN;
    if (!listaValida.includes(tipo_imagen)) {
      return error(res,
        `tipo_imagen "${tipo_imagen}" no es válido para momento="${momento}". Válidos: ${listaValida.join(', ')}`,
        400
      );
    }

    // Si ya existe una foto del mismo tipo+momento para esta asignación, reemplazarla
    const [existing] = await query(
      `SELECT id, image_url FROM vehicle_images
       WHERE asignacion_id = ? AND tipo_imagen = ? AND momento = ?`,
      [asig.id, tipo_imagen, momento]
    );

    let imageId;
    if (existing.length) {
      // Borrar el archivo anterior
      deleteFile(existing[0].image_url);
      await query(
        'UPDATE vehicle_images SET image_url = ?, uploaded_by = ? WHERE id = ?',
        [imageUrl, req.user.id, existing[0].id]
      );
      imageId = existing[0].id;
    } else {
      const [result] = await query(
        `INSERT INTO vehicle_images (vehicle_id, asignacion_id, tipo_imagen, momento, image_url, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [asig.vehicle_id, asig.id, tipo_imagen, momento, imageUrl, req.user.id]
      );
      imageId = result.insertId;
    }

    const progreso = await getProgreso(asig.id);

    return success(res, {
      id:          imageId,
      image_url:   imageUrl,
      tipo_imagen,
      momento,
      asignacion_id: asig.id,
      progreso,
    }, 'Evidencia subida correctamente');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listAsignaciones,
  getAsignacion,
  createAsignacion,
  updateAsignacion,
  deleteAsignacion,
  activarAsignacion,
  finalizarAsignacion,
  uploadEvidencia,
};
