/**
 * utils/password.utils.js
 * Utilidades de contraseñas con bcrypt
 */

'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

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

/**
 * Genera una contraseña aleatoria segura (mayúscula, minúscula, dígito y
 * carácter especial garantizados). Se excluyen caracteres ambiguos (0/O, 1/l/I)
 * para facilitar su lectura/comunicación. Cumple validatePasswordStrength.
 * @returns {string}
 */
function generatePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digit = '23456789';
  const spec  = '!@#$%&*.';
  const all   = upper + lower + digit + spec;
  const pick  = set => set[crypto.randomInt(set.length)];
  let pw = pick(upper) + pick(lower) + pick(digit) + pick(spec);
  for (let i = 0; i < 8; i++) pw += pick(all);
  // Mezclar para que las clases garantizadas no queden siempre al principio
  return pw.split('').sort(() => crypto.randomInt(3) - 1).join('');
}

module.exports = { hashPassword, comparePassword, validatePasswordStrength, generatePassword };
