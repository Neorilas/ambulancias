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
const isOperacional = (user) =>
  hasRole(user, ROLES.TECNICO) || hasRole(user, ROLES.ENFERMERO) || hasRole(user, ROLES.MEDICO);

module.exports = {
  requireRole,
  requirePermission,
  requireSuperAdmin,
  requireAdmin,
  requireAdminOrGestor,
  requireAnyRole,
  hasRole,
  hasPermission,
  isSuperAdmin,
  isAdmin,
  isOperacional,
};
