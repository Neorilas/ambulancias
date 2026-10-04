/**
 * middleware/roles.middleware.js
 * Control de acceso basado en roles (RBAC) y permisos granulares
 */

'use strict';

const { forbidden } = require('../utils/response.utils');
const { ROLES }     = require('../config/constants');

// ── Helpers internos ──────────────────────────────────────────

function hasRole(user, role) {
  return user?.roles?.includes(role) || false;
}

function hasPermission(user, perm) {
  // superadmin bypassa todos los permisos
  if (hasRole(user, ROLES.SUPERADMIN)) return true;
  return user?.permissions?.includes(perm) || false;
}

// ── Middleware por rol ────────────────────────────────────────

/**
 * requireRole(...roles) — permite acceso solo a los roles especificados
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return forbidden(res, 'No autenticado');
    const ok = allowedRoles.some(role => (req.user.roles || []).includes(role));
    if (!ok) return forbidden(res, `Acceso denegado. Requiere rol: ${allowedRoles.join(' o ')}`);
    next();
  };
}

/**
 * requirePermission(perm) — permite acceso si el usuario tiene ese permiso.
 * El superadmin pasa siempre. Los 403 se registran en audit_logs.
 */
function requirePermission(perm) {
  return (req, res, next) => {
    if (!req.user) return forbidden(res, 'No autenticado');
    if (hasPermission(req.user, perm)) return next();

    // Registrar acceso denegado en auditoría (fire-and-forget)
    // Con detalle propio: que auditoria403 no la repita.
    req._accesoDenegadoAuditado = true;
    try {
      const { logAudit } = require('../controllers/admin.controller');
      logAudit({
        userId:   req.user.id,
        userInfo: req.user.username,
        action:   'access_denied',
        details:  { permission: perm, method: req.method, url: req.originalUrl },
        ip:       req.ip,
      });
    } catch { /* nunca debe romper el flujo */ }

    return forbidden(res, `Acceso denegado. Requiere permiso: ${perm}`);
  };
}

/**
 * ocultarSalvoRoles(...roles) — como requireRole, pero quien no tiene el rol
 * recibe el MISMO 404 que una ruta que no existe (`notFound` de
 * error.middleware), no un 403. Para secciones cuya existencia no debe
 * conocer el resto de la plantilla (facturas: solo administración). Un 403
 * con «Requiere rol: …» confirmaría que la ruta está ahí.
 *
 * Se audita igual que un 403 (`access_denied`), para que el intento no pase
 * desapercibido. Va DESPUÉS de authenticate: un token caducado sigue dando
 * 401, que es lo que hace que la app refresque la sesión del administrador.
 */
function ocultarSalvoRoles(...allowedRoles) {
  return (req, res, next) => {
    if (req.user && allowedRoles.some(role => (req.user.roles || []).includes(role))) return next();

    req._accesoDenegadoAuditado = true;
    if (req.user) {
      try {
        const { logAudit } = require('../controllers/admin.controller');
        logAudit({
          userId:     req.user.id,
          userInfo:   req.user.username,
          action:     'access_denied',
          entityType: 'ruta_oculta',
          details:    { ruta: `${req.method} ${req.originalUrl}`, motivo: `oculta salvo para: ${allowedRoles.join(', ')}` },
          ip:         req.ip,
          userAgent:  req.headers?.['user-agent'],
        });
      } catch { /* la auditoría nunca rompe la respuesta */ }
    }
    return res.status(404).json({ success: false, message: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
  };
}

// ── Aliases de conveniencia ───────────────────────────────────

const requireSuperAdmin    = requireRole(ROLES.SUPERADMIN);
const requireAdmin         = requireRole(ROLES.ADMINISTRADOR);
const requireAdminOrGestor = requireRole(ROLES.ADMINISTRADOR, ROLES.GESTOR);

const requireAnyRole = (req, res, next) => {
  if (!req.user || !req.user.roles || req.user.roles.length === 0) {
    return forbidden(res, 'Sin roles asignados');
  }
  next();
};

// ── Helpers de comprobación (para uso en controllers) ─────────

const isSuperAdmin  = (user) => hasRole(user, ROLES.SUPERADMIN);
const isAdmin       = (user) => hasRole(user, ROLES.ADMINISTRADOR);
const isGestor      = (user) => hasRole(user, ROLES.GESTOR);

/**
 * ¿Lleva un rol operativo? Literal, sin mirar si además tiene mando.
 *
 * Es la lista de los roles que salen de servicio con la ambulancia. Un rol
 * creado desde `/usuarios` (POST /users/roles) NO entra aquí: existe en la
 * tabla `roles` y se puede repartir, pero para el código no lleva vehículo, y
 * su portador se queda sin poder subir evidencia (403 en `ownership`). Por eso
 * un rol de campo nuevo se añade también en `config/constants.js`, aquí y en
 * el `isOperacional` del frontend.
 */
const tieneRolDeCampo = (user) =>
  hasRole(user, ROLES.TECNICO) || hasRole(user, ROLES.ENFERMERO) ||
  hasRole(user, ROLES.MEDICO)  || hasRole(user, ROLES.TES_CONDUCTOR);

/**
 * ¿Es personal de campo **sin mando**?
 *
 * Los roles no son excluyentes: un administrador o un gestor pueden llevar
 * además el rol `tecnico` porque también salen de servicio.
 *
 * La regla, y conviene respetarla al añadir comprobaciones nuevas:
 *
 * - para **recortar** lo que se ve o se puede hacer → `isOperacional`. Ese
 *   recorte (la flota reducida a los vehículos de un trabajo activo, los
 *   trabajos a los propios) no debe caerle a quien gestiona: dejaba al
 *   administrador sin un solo vehículo en el desplegable de «Nueva
 *   asignación» y sin lista de flota;
 * - para **conceder** algo por llevar el vehículo encima → `tieneRolDeCampo`,
 *   que no le quita nada a nadie.
 */
const isOperacional = (user) =>
  tieneRolDeCampo(user) && !isSuperAdmin(user) && !isAdmin(user) && !isGestor(user);

module.exports = {
  requireRole,
  ocultarSalvoRoles,
  requirePermission,
  requireSuperAdmin,
  requireAdmin,
  requireAdminOrGestor,
  requireAnyRole,
  hasRole,
  hasPermission,
  isSuperAdmin,
  isAdmin,
  isGestor,
  tieneRolDeCampo,
  isOperacional,
};
