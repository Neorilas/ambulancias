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

const LONGITUD_MINIMA = 10;

/**
 * Valida la contraseña.
 *
 * Antes solo se miraba la longitud (8), así que "aaaaaaaa" pasaba. El bloqueo
 * de cuenta y el rate limit frenan el fuerza-bruta contra la API, pero no
 * sirven de nada si la contraseña se reutiliza en otro sitio y ese sitio se
 * filtra. Se pide algo de variedad sin llegar a lo impracticable: la plantilla
 * es personal de campo y quien reparte las contraseñas es un administrador.
 *
 * `contexto` permite rechazar lo más obvio (la propia contraseña es el
 * username o el DNI) cuando quien llama tiene esos datos a mano.
 *
 * @param {string} password
 * @param {{ username?: string, dni?: string }} [contexto]
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePasswordStrength(password, contexto = {}) {
  const errors = [];

  if (!password || password.length < LONGITUD_MINIMA) {
    errors.push(`Mínimo ${LONGITUD_MINIMA} caracteres`);
  }

  if (password) {
    const clases = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/]
      .filter(re => re.test(password)).length;
    if (clases < 2) {
      errors.push('Combina al menos dos tipos: minúsculas, mayúsculas, números o símbolos');
    }

    const enMinusculas = password.toLowerCase();
    for (const [campo, valor] of [['usuario', contexto.username], ['DNI', contexto.dni]]) {
      if (valor && String(valor).trim() && enMinusculas.includes(String(valor).trim().toLowerCase())) {
        errors.push(`No puede contener el ${campo}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Genera una contraseña aleatoria segura (mayúscula, minúscula, dígito y
 * carácter especial garantizados). Se excluyen caracteres ambiguos (0/O, 1/l/I)
 * para facilitar su lectura/comunicación. Son 12 caracteres con las cuatro
 * clases, así que siempre cumple validatePasswordStrength.
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
