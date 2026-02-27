/**
 * middleware/roles.middleware.js
 * Control de acceso basado en roles (RBAC)
 */

'use strict';

const { forbidden } = require('../utils/response.utils');
const { ROLES }     = require('../config/constants');

/**
 * Genera middleware que permite acceso solo a los roles especificados
 * @param {...string} allowedRoles - nombres de roles permitidos
 * @returns {Function} middleware
 *
 * Uso: router.get('/ruta', authenticate, requireRole('administrador', 'gestor'), handler)
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return forbidden(res, 'No autenticado');
    }

    const userRoles = req.user.roles || [];

    const hasRole = allowedRoles.some(role => userRoles.includes(role));
    if (!hasRole) {
      return forbidden(res,
        `Acceso denegado. Requiere rol: ${allowedRoles.join(' o ')}`
      );
    }

    next();
  };
}

/**
 * Verifica que el usuario es administrador
 */
const requireAdmin = requireRole(ROLES.ADMINISTRADOR);

/**
 * Verifica que el usuario es administrador o gestor
 */
const requireAdminOrGestor = requireRole(ROLES.ADMINISTRADOR, ROLES.GESTOR);

/**
 * Verifica que el usuario tiene cualquier rol reconocido (está autenticado con rol)
 */
const requireAnyRole = (req, res, next) => {
  if (!req.user || !req.user.roles || req.user.roles.length === 0) {
    return forbidden(res, 'Sin roles asignados');
  }
  next();
};

/**
 * Helper: comprobar si un usuario tiene un rol específico
 * @param {Object} user - req.user
 * @param {string} role
 * @returns {boolean}
 */
function hasRole(user, role) {
  return user?.roles?.includes(role) || false;
}

/**
 * Helper: comprobar si un usuario es administrador
 */
const isAdmin = (user) => hasRole(user, ROLES.ADMINISTRADOR);

/**
 * Helper: comprobar si es operacional (tecnico/enfermero/medico)
 */
const isOperacional = (user) =>
  hasRole(user, ROLES.TECNICO) ||
  hasRole(user, ROLES.ENFERMERO) ||
  hasRole(user, ROLES.MEDICO);

module.exports = {
  requireRole,
  requireAdmin,
  requireAdminOrGestor,
  requireAnyRole,
  hasRole,
  isAdmin,
  isOperacional,
};
