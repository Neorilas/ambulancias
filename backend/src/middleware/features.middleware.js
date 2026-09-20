/**
 * middleware/features.middleware.js
 * Feature flags como control de acceso REAL, no solo como menú.
 *
 * Hasta ahora los flags de `app_features` solo vivían en el frontend
 * (`FeaturesContext` + `ProtectedRoute`), y para lo que se usaban —enseñar u
 * ocultar pantallas de trabajos que nadie usa— bastaba. El mapa de flota es
 * otra cosa: su flag decide **quién puede ver dónde está cada vehículo**, y un
 * interruptor que solo actúa en el navegador no es un control de acceso. Sin
 * esto, un administrador con el menú oculto seguiría pudiendo llamar a
 * `GET /api/v1/flota/ubicaciones` a mano y obtener las posiciones.
 *
 * Se consulta en cada petición, igual que los permisos (`auth.middleware`): un
 * flag que el superadmin acaba de apagar tiene que surtir efecto ya, no en el
 * siguiente login de cada uno.
 */

'use strict';

const { query }     = require('../config/database');
const { forbidden } = require('../utils/response.utils');
const { ROLES }     = require('../config/constants');
const logger        = require('../utils/logger.utils');

/** ¿Está encendido este flag? Un flag que no existe cuenta como apagado. */
async function featureActiva(key) {
  const [rows] = await query(
    'SELECT enabled FROM app_features WHERE feature_key = ? LIMIT 1',
    [key]
  );
  return rows.length > 0 && Boolean(rows[0].enabled);
}

/**
 * `requireFeature(key)` — exige que el flag esté encendido.
 *
 * **El superadmin pasa siempre**, y no es un descuido: es el mismo bypass que
 * hacen `hasPermission` (roles.middleware) y `isFeatureEnabled` (frontend). Si
 * aquí se comportara distinto, el criterio de «quién ve qué» diría cosas
 * diferentes según a quién se le pregunte — y además dejaría al superadmin sin
 * poder comprobar lo que acaba de encender.
 *
 * Un fallo de base de datos deniega, no concede: ante la duda, no se enseña
 * dónde está la flota.
 */
function requireFeature(key) {
  return async (req, res, next) => {
    if (!req.user) return forbidden(res, 'No autenticado');
    if ((req.user.roles || []).includes(ROLES.SUPERADMIN)) return next();

    try {
      if (await featureActiva(key)) return next();
    } catch (err) {
      logger.error(`No se pudo comprobar el flag ${key}: ${err.message}`);
      return forbidden(res, 'No se pudo comprobar el acceso a esta funcionalidad');
    }

    // Se audita como cualquier otro 403, para que en el panel se vea quién
    // intentó entrar a algo que está apagado.
    try {
      const { logAudit } = require('../controllers/admin.controller');
      logAudit({
        userId:   req.user.id,
        userInfo: req.user.username,
        action:   'access_denied',
        details:  { feature: key, method: req.method, url: req.originalUrl },
        ip:       req.ip,
      });
    } catch { /* nunca debe romper el flujo */ }

    return forbidden(res, 'Esta funcionalidad no está activada');
  };
}

module.exports = { requireFeature, featureActiva };
