/**
 * middleware/ownership.middleware.js
 * Comprobaciones de pertenencia para los endpoints que escriben evidencia
 * fotográfica.
 *
 * Existe porque la autorización de las subidas se estaba escribiendo a mano en
 * cada controlador y en dos de ellos se olvidó: cualquier usuario autenticado
 * podía subir (o sobrescribir) fotos de un vehículo o de un trabajo con el que
 * no tenía nada que ver. Como las fotos son la prueba de en qué estado quedó la
 * ambulancia, eso rompía la garantía del producto.
 *
 * Van montados ANTES de `processAndSave`: multer ya ha dejado el fichero en
 * memoria y `req.body` está disponible, pero todavía no se ha escrito nada en
 * disco ni ha pasado por Sharp. Un 403 aquí no deja basura ni procesa la imagen
 * de alguien que no tenía por qué subirla.
 */

'use strict';

const { query }       = require('../config/database');
const { forbidden }   = require('../utils/response.utils');
const { hasPermission, tieneRolDeCampo } = require('./roles.middleware');
const { PERMISSIONS } = require('../config/constants');

/**
 * ¿Tiene este usuario el vehículo en la mano ahora mismo?
 * Vale tanto por un trabajo activo como por una asignación libre activa: son
 * las dos formas que tiene un operacional de llevar una ambulancia. En la
 * asignación solo cuentan los RESPONSABLES: el personal que va con el vehículo
 * la ve, pero no sube la evidencia de su estado.
 */
async function tieneElVehiculoAsignado(userId, vehicleId) {
  const [rows] = await query(
    `SELECT 1 AS ok
     FROM trabajo_vehiculos tv
     JOIN trabajos t          ON tv.trabajo_id = t.id
     JOIN trabajo_usuarios tu ON t.id = tu.trabajo_id
     WHERE tv.vehicle_id = ? AND tu.user_id = ?
       AND t.estado = 'activo' AND t.deleted_at IS NULL
     UNION
     SELECT 1 AS ok
     FROM asignaciones_libres al
     WHERE al.vehicle_id = ?
       AND al.estado IN ('programada', 'activa') AND al.deleted_at IS NULL
       AND (al.user_id = ? OR EXISTS (
             SELECT 1 FROM asignacion_usuarios au
             WHERE au.asignacion_id = al.id AND au.user_id = ? AND au.rol = 'responsable'))
     LIMIT 1`,
    [vehicleId, userId, vehicleId, userId, userId]
  );
  return rows.length > 0;
}

/**
 * POST /vehicles/:id/images — subida suelta de fotos a un vehículo.
 * Pasa quien gestiona la flota, o el operacional que tenga ese vehículo
 * asignado. Cualquier otro se queda fuera.
 */
async function requireVehicleUploadAccess(req, res, next) {
  try {
    const vehicleId = parseInt(req.params.id);

    if (hasPermission(req.user, PERMISSIONS.MANAGE_VEHICLES)) return next();

    // Aquí se *concede*, no se recorta: vale el rol operativo a secas. Un jefe
    // de flota que además sea técnico ya ha pasado por el permiso de arriba.
    if (tieneRolDeCampo(req.user) && await tieneElVehiculoAsignado(req.user.id, vehicleId)) {
      return next();
    }

    return forbidden(res, 'No tienes este vehículo asignado');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /trabajos/:id/evidencias — fotos de inicio/fin de un trabajo.
 * Mismo criterio que `finalizeTrabajo`: pasa quien gestiona trabajos, o el
 * responsable de ese vehículo dentro de ese trabajo. Nadie más, porque estas
 * fotos se sobrescriben entre sí.
 */
async function requireTrabajoEvidenciaAccess(req, res, next) {
  try {
    const trabajoId = parseInt(req.params.id);
    const vehicleId = parseInt(req.body.vehicle_id);

    if (hasPermission(req.user, PERMISSIONS.MANAGE_TRABAJOS)) return next();

    if (!vehicleId || Number.isNaN(vehicleId)) {
      return forbidden(res, 'No eres el responsable de este vehículo en este trabajo');
    }

    const [rows] = await query(
      `SELECT 1 AS ok
       FROM trabajo_vehiculos tv
       JOIN trabajos t ON tv.trabajo_id = t.id
       WHERE tv.trabajo_id = ? AND tv.vehicle_id = ?
         AND tv.responsable_user_id = ? AND t.deleted_at IS NULL`,
      [trabajoId, vehicleId, req.user.id]
    );
    if (rows.length) return next();

    return forbidden(res, 'No eres el responsable de este vehículo en este trabajo');
  } catch (err) {
    next(err);
  }
}

/**
 * POST /asignaciones/:id/evidencias — fotos de inicio/fin de una asignación.
 * Pasa quien gestiona trabajos o un RESPONSABLE de esa asignación; el personal
 * que va con el vehículo no (§6.1 del mapa). El controlador lo vuelve a
 * comprobar, pero aquí va ANTES de processAndSave: sin esto la foto de un
 * rechazado se escribía en disco y se quedaba huérfana tras el 403.
 */
async function requireAsignacionEvidenciaAccess(req, res, next) {
  try {
    if (hasPermission(req.user, PERMISSIONS.MANAGE_TRABAJOS)) return next();

    const [rows] = await query(
      `SELECT 1 AS ok
       FROM asignaciones_libres al
       WHERE al.id = ? AND al.deleted_at IS NULL
         AND (al.user_id = ? OR EXISTS (
               SELECT 1 FROM asignacion_usuarios au
               WHERE au.asignacion_id = al.id AND au.user_id = ? AND au.rol = 'responsable'))`,
      [parseInt(req.params.id), req.user.id, req.user.id]
    );
    if (rows.length) return next();

    return forbidden(res, 'No puedes subir evidencias de esta asignación');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  tieneElVehiculoAsignado,
  requireAsignacionEvidenciaAccess,
  requireVehicleUploadAccess,
  requireTrabajoEvidenciaAccess,
};
