/**
 * controllers/auth.controller.js
 * Autenticación: login, refresh, logout, me
 */

'use strict';

const { query, transaction }          = require('../config/database');
const { comparePassword }            = require('../utils/password.utils');
const {
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  verifyAccessToken,
  refreshTokenExpiresAt,
}                                     = require('../utils/jwt.utils');
const { success, error, unauthorized } = require('../utils/response.utils');
const { LOCKOUT }                     = require('../config/constants');
const logger                          = require('../utils/logger.utils');

// ============================================================
// Helpers internos
// ============================================================

async function recordLoginAttempt(username, ip, userAgent, success) {
  await query(
    'INSERT INTO login_attempts (username, ip_address, success, user_agent) VALUES (?, ?, ?, ?)',
    [username, ip, success ? 1 : 0, userAgent?.substring(0, 500) || null]
  );
}

async function isAccountLocked(username) {
  const windowStart = new Date(Date.now() - LOCKOUT.DURATION_MINUTES * 60 * 1000);
  const [rows] = await query(
    `SELECT COUNT(*) AS attempts
     FROM login_attempts
     WHERE username = ? AND success = 0 AND attempted_at >= ?`,
    [username, windowStart.toISOString().slice(0, 19).replace('T', ' ')]
  );
  return rows[0].attempts >= LOCKOUT.MAX_ATTEMPTS;
}

// ============================================================
// POST /auth/login
// ============================================================
async function login(req, res, next) {
  const { username, password } = req.body;
  const ip        = req.ip || req.socket?.remoteAddress || 'unknown';
  const userAgent = req.headers['user-agent'];

  try {
    // Verificar bloqueo de cuenta por intentos fallidos
    const locked = await isAccountLocked(username);
    if (locked) {
      await recordLoginAttempt(username, ip, userAgent, false);
      return error(res,
        `Cuenta bloqueada temporalmente por exceso de intentos fallidos. ` +
        `Intenta de nuevo en ${LOCKOUT.DURATION_MINUTES} minutos.`,
        429
      );
    }

    // Buscar usuario
    const [rows] = await query(
      `SELECT u.id, u.username, u.password_hash, u.nombre, u.apellidos, u.activo, u.deleted_at,
              GROUP_CONCAT(r.nombre SEPARATOR ',') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       LEFT JOIN roles r ON ur.role_id = r.id
       WHERE u.username = ?
       GROUP BY u.id`,
      [username]
    );

    // Usuario no existe → mismo mensaje genérico (no revelar si existe o no)
    if (!rows.length) {
      await recordLoginAttempt(username, ip, userAgent, false);
      return unauthorized(res, 'Credenciales incorrectas');
    }

    const user = rows[0];

    // Cuenta eliminada o inactiva
    if (user.deleted_at || !user.activo) {
      await recordLoginAttempt(username, ip, userAgent, false);
      return unauthorized(res, 'Credenciales incorrectas');
    }

    // Verificar contraseña
    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      await recordLoginAttempt(username, ip, userAgent, false);
      return unauthorized(res, 'Credenciales incorrectas');
    }

    // Login correcto → limpiar intentos fallidos recientes
    await recordLoginAttempt(username, ip, userAgent, true);

    const roles = user.roles ? user.roles.split(',') : [];

    // Generar tokens
    const accessToken = generateAccessToken({ id: user.id, username: user.username, roles });
    const { token: refreshToken, tokenHash } = generateRefreshToken();
    const expiresAt = refreshTokenExpiresAt();

    // Guardar refresh token en BD (hash)
    await query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)',
      [user.id, tokenHash, expiresAt, ip, userAgent?.substring(0, 500) || null]
    );

    logger.info(`Login exitoso: ${username} desde ${ip}`);

    return success(res, {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60, // segundos
      user: {
        id:       user.id,
        username: user.username,
        nombre:   user.nombre,
        apellidos: user.apellidos,
        roles,
      },
    }, 'Login exitoso');

  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /auth/refresh
// ============================================================
async function refresh(req, res, next) {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return unauthorized(res, 'Refresh token no proporcionado');
  }

  try {
    const tokenHash = hashRefreshToken(refreshToken);

    // Buscar token en BD
    const [rows] = await query(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked,
              u.username, u.activo, u.deleted_at,
              GROUP_CONCAT(r.nombre SEPARATOR ',') AS roles
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       LEFT JOIN roles r ON ur.role_id = r.id
       WHERE rt.token_hash = ?
       GROUP BY rt.id`,
      [tokenHash]
    );

    if (!rows.length) return unauthorized(res, 'Refresh token inválido');

    const rt = rows[0];

    if (rt.revoked)                              return unauthorized(res, 'Refresh token revocado');
    if (new Date(rt.expires_at) < new Date())    return unauthorized(res, 'Refresh token expirado');
    if (!rt.activo || rt.deleted_at)             return unauthorized(res, 'Cuenta inactiva');

    const roles = rt.roles ? rt.roles.split(',') : [];

    // Rotar refresh token (invalidar el viejo, emitir uno nuevo)
    const { token: newRefreshToken, tokenHash: newTokenHash } = generateRefreshToken();
    const expiresAt = refreshTokenExpiresAt();

    await transaction(async (conn) => {
      await conn.execute(
        'UPDATE refresh_tokens SET revoked = 1, revoked_at = NOW() WHERE id = ?',
        [rt.id]
      );
      await conn.execute(
        'INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address) VALUES (?, ?, ?, ?)',
        [rt.user_id, newTokenHash, expiresAt, req.ip]
      );
    });

    const accessToken = generateAccessToken({ id: rt.user_id, username: rt.username, roles });

    return success(res, {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn:    15 * 60,
    }, 'Token refrescado');

  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /auth/logout
// ============================================================
async function logout(req, res, next) {
  const { refreshToken } = req.body;

  try {
    if (refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      await query(
        'UPDATE refresh_tokens SET revoked = 1, revoked_at = NOW() WHERE token_hash = ?',
        [tokenHash]
      );
    }
    return success(res, null, 'Sesión cerrada correctamente');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /auth/me
// ============================================================
async function me(req, res, next) {
  try {
    const [rows] = await query(
      `SELECT id, username, email, nombre, apellidos, dni, telefono, activo, created_at
       FROM users WHERE id = ? AND deleted_at IS NULL`,
      [req.user.id]
    );

    if (!rows.length) return unauthorized(res, 'Usuario no encontrado');

    return success(res, { ...rows[0], roles: req.user.roles });
  } catch (err) {
    next(err);
  }
}

module.exports = { login, refresh, logout, me };
