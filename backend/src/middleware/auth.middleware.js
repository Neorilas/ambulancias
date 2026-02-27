/**
 * middleware/auth.middleware.js
 * Verificación de JWT en cabecera Authorization
 */

'use strict';

const { verifyAccessToken }      = require('../utils/jwt.utils');
const { unauthorized }           = require('../utils/response.utils');
const { query }                  = require('../config/database');

/**
 * Middleware: verifica que el request tenga un access token válido
 * y adjunta la información del usuario en req.user
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return unauthorized(res, 'Token de acceso no proporcionado');
    }

    const token = authHeader.split(' ')[1];
    if (!token) return unauthorized(res, 'Token malformado');

    // Verificar y decodificar el JWT
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return unauthorized(res, 'Token expirado. Utiliza el endpoint /auth/refresh');
      }
      return unauthorized(res, 'Token inválido');
    }

    if (decoded.type !== 'access') {
      return unauthorized(res, 'Tipo de token incorrecto');
    }

    // Verificar que el usuario sigue activo en BD
    const [rows] = await query(
      `SELECT u.id, u.username, u.nombre, u.apellidos, u.activo, u.deleted_at,
              GROUP_CONCAT(r.nombre SEPARATOR ',') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       LEFT JOIN roles r ON ur.role_id = r.id
       WHERE u.id = ?
       GROUP BY u.id`,
      [decoded.sub]
    );

    if (!rows.length) return unauthorized(res, 'Usuario no encontrado');
    const user = rows[0];

    if (!user.activo || user.deleted_at !== null) {
      return unauthorized(res, 'Cuenta inactiva o eliminada');
    }

    // Adjuntar datos del usuario al request
    req.user = {
      id:       user.id,
      username: user.username,
      nombre:   user.nombre,
      apellidos: user.apellidos,
      roles:    user.roles ? user.roles.split(',') : [],
    };

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Middleware opcional: si hay token lo procesa, si no continúa sin usuario
 */
async function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return next();
  return authenticate(req, res, next);
}

module.exports = { authenticate, optionalAuth };
