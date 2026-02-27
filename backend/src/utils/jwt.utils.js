/**
 * utils/jwt.utils.js
 * Generación y verificación de tokens JWT
 */

'use strict';

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_EXPIRY  = process.env.JWT_ACCESS_EXPIRES  || '15m';
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRES || '7d';

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  throw new Error('JWT secrets not configured. Check JWT_ACCESS_SECRET and JWT_REFRESH_SECRET in .env');
}

/**
 * Genera access token JWT (vida corta)
 * @param {{ id, username, roles }} payload
 * @returns {string}
 */
function generateAccessToken(payload) {
  return jwt.sign(
    {
      sub:      payload.id,
      username: payload.username,
      roles:    payload.roles || [],
      jti:      uuidv4(),
      type:     'access',
    },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRY, algorithm: 'HS256' }
  );
}

/**
 * Genera refresh token opaco (UUID aleatorio) y su hash para almacenar en BD
 * @returns {{ token: string, tokenHash: string }}
 */
function generateRefreshToken() {
  const token     = uuidv4() + '-' + crypto.randomBytes(32).toString('hex');
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
  generateRefreshToken,
  hashRefreshToken,
  verifyAccessToken,
  decodeToken,
  refreshTokenExpiresAt,
};
