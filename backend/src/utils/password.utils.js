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
 * - Al menos 1 mayúscula
 * - Al menos 1 minúscula
 * - Al menos 1 número
 * - Al menos 1 carácter especial
 * @param {string} password
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePasswordStrength(password) {
  const errors = [];
  if (!password || password.length < 8)   errors.push('Mínimo 8 caracteres');
  if (!/[A-Z]/.test(password))            errors.push('Debe incluir al menos una mayúscula');
  if (!/[a-z]/.test(password))            errors.push('Debe incluir al menos una minúscula');
  if (!/[0-9]/.test(password))            errors.push('Debe incluir al menos un número');
  if (!/[^A-Za-z0-9]/.test(password))     errors.push('Debe incluir al menos un carácter especial');
  return { valid: errors.length === 0, errors };
}

module.exports = { hashPassword, comparePassword, validatePasswordStrength };
