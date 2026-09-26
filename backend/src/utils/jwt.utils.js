/**
 * utils/jwt.utils.js
 * Generación y verificación de tokens JWT
 */

'use strict';

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRY  = process.env.JWT_ACCESS_EXPIRES  || '15m';
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRES || '7d';
// Vida de una sesión impersonada. No se renueva: al caducar, el frontend
// vuelve solo a la sesión del superadmin.
const IMPERSONATION_EXPIRY_MIN = 60;

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  throw new Error('JWT secrets not configured. Check JWT_ACCESS_SECRET and JWT_REFRESH_SECRET in .env');
}

/**
 * Genera access token JWT (vida corta)
 *
 * Los permisos NO van en el token a propósito: auth.middleware los consulta en
 * role_permissions en cada petición, así que quitar un permiso a un rol tiene
 * efecto en el acto y no a los 15 minutos. Un `permissions` en el payload se
 * ignora.
 * @param {{ id, username, roles }} payload
 * @returns {string}
 */
function generateAccessToken(payload) {
  return jwt.sign(
    {
      sub:      payload.id,
      username: payload.username,
      roles:    payload.roles || [],
      jti:      crypto.randomUUID(),
      type:     'access',
    },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRY, algorithm: 'HS256' }
  );
}

/**
 * Token de acceso de un superadmin que está viendo la app como otro usuario.
 *
 * Es un access token normal del usuario impersonado (`sub` es el suyo, así que
 * auth.middleware carga SUS roles y permisos y el resto de la API no se entera)
 * más `imp`, el id del superadmin que hay detrás. El middleware comprueba en
 * cada petición que `imp` sigue siendo superadmin y activo, y la auditoría
 * anota a los dos. No lleva refresh token.
 * @param {{ id, username, roles }} payload  el usuario impersonado
 * @param {number} impersonadorId            el superadmin
 */
function generateImpersonationToken(payload, impersonadorId) {
  return jwt.sign(
    {
      sub:      payload.id,
      username: payload.username,
      roles:    payload.roles || [],
      imp:      impersonadorId,
      jti:      crypto.randomUUID(),
      type:     'access',
    },
    ACCESS_SECRET,
    { expiresIn: IMPERSONATION_EXPIRY_MIN * 60, algorithm: 'HS256' }
  );
}

/**
 * Genera refresh token opaco (UUID aleatorio) y su hash para almacenar en BD
 * @returns {{ token: string, tokenHash: string }}
 */
function generateRefreshToken() {
  const token     = crypto.randomUUID() + '-' + crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

/**
 * Genera hash SHA-256 de un refresh token
 * @param {string} token
 * @returns {string}
 */
function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Verifica y decodifica un access token
 * @param {string} token
 * @returns {object} payload decodificado
 * @throws {jwt.JsonWebTokenError | jwt.TokenExpiredError}
 */
function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET, { algorithms: ['HS256'] });
}

/**
 * Decodifica token sin verificar firma (para leer el payload antes de expirar)
 * @param {string} token
 * @returns {object|null}
 */
function decodeToken(token) {
  try {
    return jwt.decode(token);
  } catch {
    return null;
  }
}

/**
 * Calcula la fecha de expiración del refresh token
 * @returns {Date}
 */
function refreshTokenExpiresAt() {
  const days  = parseInt(REFRESH_EXPIRY) || 7;
  const date  = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

module.exports = {
  generateAccessToken,
  generateImpersonationToken,
  IMPERSONATION_EXPIRY_MIN,
  generateRefreshToken,
  hashRefreshToken,
  verifyAccessToken,
  decodeToken,
  refreshTokenExpiresAt,
};
