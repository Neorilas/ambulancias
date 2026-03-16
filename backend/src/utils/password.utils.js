/**
 * utils/password.utils.js
 * Utilidades de contraseñas con bcrypt
 */

'use strict';

const bcrypt = require('bcryptjs');

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;

/**
 * Genera hash bcrypt de una contraseña en claro
 * @param {string} plainPassword
 * @returns {Promise<string>}
 */
async function hashPassword(plainPassword) {
  const salt = await bcrypt.genSalt(ROUNDS);
  return bcrypt.hash(plainPassword, salt);
}

/**
 * Compara contraseña en claro con hash almacenado
 * @param {string} plainPassword
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function comparePassword(plainPassword, hash) {
  return bcrypt.compare(plainPassword, hash);
}

/**
 * Valida que la contraseña cumpla los requisitos mínimos:
 * - Mínimo 8 caracteres
 * @param {string} password
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePasswordStrength(password) {
  const errors = [];
  if (!password || password.length < 8)   errors.push('Mínimo 8 caracteres');
  return { valid: errors.length === 0, errors };
}

module.exports = { hashPassword, comparePassword, validatePasswordStrength };
