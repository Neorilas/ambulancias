#!/usr/bin/env node
/**
 * scripts/reset-password.js
 * Cambia la contraseña de un usuario existente sin pasar por la API.
 *
 * Pensado para el caso en que nadie puede resetear desde la app: la ruta
 * POST /users/:id/reset-password exige que solo un superadmin resetee a otro
 * superadmin, así que si se pierde la contraseña del único superadmin no queda
 * camino por la aplicación.
 *
 * La contraseña se teclea aquí (oculta) y nunca se pasa por argumentos ni se
 * escribe en disco. Además revoca los refresh tokens activos y limpia los
 * intentos fallidos recientes (que podrían mantener la cuenta bloqueada).
 *
 * Uso: node scripts/reset-password.js [username]
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const readline = require('readline');
const mysql    = require('mysql2/promise');
const bcrypt   = require('bcryptjs');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

// Lectura oculta: muestra asteriscos en lugar de la contraseña
function askPassword(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      return reject(new Error('Se necesita un terminal interactivo (usa docker exec -it / ssh -t)'));
    }
    process.stdout.write(question);
    let password = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    function onData(char) {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(password);
      } else if (char === '\u0003') {
        process.stdout.write('\n');
        process.exit(1);
      } else if (char === '\u007f') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(question + '*'.repeat(password.length));
        }
      } else {
        password += char;
        process.stdout.write('*');
      }
    }
    process.stdin.on('data', onData);
  });
}

// Mismos requisitos que create-admin.js (la API solo exige 8 caracteres)
function validatePassword(pw) {
  const errors = [];
  if (pw.length < 8)             errors.push('Mínimo 8 caracteres');
  if (!/[A-Z]/.test(pw))         errors.push('Al menos una mayúscula');
  if (!/[a-z]/.test(pw))         errors.push('Al menos una minúscula');
  if (!/[0-9]/.test(pw))         errors.push('Al menos un número');
  if (!/[^A-Za-z0-9]/.test(pw))  errors.push('Al menos un carácter especial');
  return errors;
}

function buildDbConfig() {
  const rawUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (rawUrl) {
    const u = new URL(rawUrl);
    return {
      host:     u.hostname,
      port:     parseInt(u.port) || 3306,
      user:     decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    };
  }
  return {
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME     || 'ambulancia_db',
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
  };
}

async function main() {
  console.log('\n=== CAMBIO DE CONTRASEÑA (acceso directo a BD) ===\n');

  const username = (process.argv[2] || await ask('Username: ')).trim();
  if (!username) {
    console.error('\n✗  Username vacío.\n');
    process.exit(1);
  }

  const conn = await mysql.createConnection(buildDbConfig());

  try {
    const [rows] = await conn.execute(
      `SELECT u.id, u.username, u.nombre, u.apellidos, u.activo,
              GROUP_CONCAT(r.nombre SEPARATOR ',') AS roles
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.id
         LEFT JOIN roles r       ON r.id = ur.role_id
        WHERE u.username = ? AND u.deleted_at IS NULL
        GROUP BY u.id`,
      [username]
    );
    if (!rows.length) {
      console.error(`\n✗  No existe el usuario "${username}" (o está eliminado).\n`);
      process.exit(1);
    }
    const user = rows[0];
    console.log(`\nUsuario: ${user.username} — ${user.nombre} ${user.apellidos}`);
    console.log(`Roles:   ${user.roles || '(ninguno)'}`);
    console.log(`Activo:  ${user.activo ? 'sí' : 'NO'}\n`);

    const confirmUser = (await ask('¿Cambiar la contraseña de este usuario? (si/no): ')).trim().toLowerCase();
    if (confirmUser !== 'si' && confirmUser !== 'sí' && confirmUser !== 's') {
      console.log('\nCancelado. No se ha tocado nada.\n');
      process.exit(0);
    }

    let password;
    while (true) {
      password = await askPassword('Nueva contraseña: ');
      const errors = validatePassword(password);
      if (errors.length) {
        console.log('\n⚠  No cumple los requisitos:');
        errors.forEach(e => console.log('   •', e));
        console.log('');
        continue;
      }
      const confirm = await askPassword('Repite la contraseña: ');
      if (password !== confirm) {
        console.log('\n⚠  No coinciden. Otra vez.\n');
        continue;
      }
      break;
    }
    rl.close();

    console.log(`\n⏳ Generando hash bcrypt (${BCRYPT_ROUNDS} rounds)...`);
    const passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(BCRYPT_ROUNDS));

    await conn.beginTransaction();
    try {
      await conn.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, user.id]);
      const [tokens] = await conn.execute(
        'UPDATE refresh_tokens SET revoked = 1, revoked_at = NOW() WHERE user_id = ? AND revoked = 0',
        [user.id]
      );
      // Los intentos fallidos recientes mantienen la cuenta bloqueada aunque la
      // contraseña sea nueva: se limpian para poder entrar de inmediato.
      const [attempts] = await conn.execute(
        'DELETE FROM login_attempts WHERE username = ? AND success = 0',
        [user.username]
      );
      await conn.execute(
        `INSERT INTO audit_logs (user_id, user_info, action, entity_type, entity_id, details)
         VALUES (?, ?, 'reset_password', 'users', ?, ?)`,
        [null, `script:reset-password (${user.username})`, user.id,
         JSON.stringify({ via: 'scripts/reset-password.js', target_username: user.username })]
      );
      await conn.commit();

      console.log('\n✅ Contraseña actualizada.');
      console.log(`   Refresh tokens revocados: ${tokens.affectedRows}`);
      console.log(`   Intentos fallidos borrados: ${attempts.affectedRows}\n`);
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('\n✗  Error:', err.message, '\n');
  process.exit(1);
});
