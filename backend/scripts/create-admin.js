#!/usr/bin/env node
/**
 * scripts/create-admin.js
 * Crea el usuario administrador inicial de forma segura.
 * No almacena contraseñas en claro ni en archivos.
 *
 * Uso: node scripts/create-admin.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const readline = require('readline');
const mysql    = require('mysql2/promise');
const bcrypt   = require('bcryptjs');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;

// Interfaz readline para input seguro (sin mostrar la contraseña no es posible
// en Node estándar sin librerías, pero podemos usar stdin con proceso limpio)
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

// Mostrar caracteres * en lugar de la contraseña
function askPassword(question) {
  return new Promise(resolve => {
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
        process.exit();
      } else if (char === '\u007f') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.clearLine();
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

function validatePassword(pw) {
  const errors = [];
  if (pw.length < 8)               errors.push('Mínimo 8 caracteres');
  if (!/[A-Z]/.test(pw))           errors.push('Al menos una mayúscula');
  if (!/[a-z]/.test(pw))           errors.push('Al menos una minúscula');
  if (!/[0-9]/.test(pw))           errors.push('Al menos un número');
  if (!/[^A-Za-z0-9]/.test(pw))   errors.push('Al menos un carácter especial');
  return errors;
}

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   CREACIÓN DE USUARIO ADMINISTRADOR       ║');
  console.log('║   Sistema de Gestión de Ambulancias        ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const username  = (await ask('Username (sugerido: ops_root_x9A7): ')).trim() || 'ops_root_x9A7';
  const nombre    = (await ask('Nombre: ')).trim();
  const apellidos = (await ask('Apellidos: ')).trim();
  const dni       = (await ask('DNI: ')).trim();
  const email     = (await ask('Email (opcional, Enter para omitir): ')).trim() || null;

  let password;
  while (true) {
    password = await askPassword('Contraseña: ');
    const errors = validatePassword(password);
    if (errors.length > 0) {
      console.log('\n⚠  Contraseña no cumple los requisitos:');
      errors.forEach(e => console.log('   •', e));
      console.log('');
    } else {
      const confirm = await askPassword('Confirmar contraseña: ');
      if (password !== confirm) {
        console.log('\n⚠  Las contraseñas no coinciden. Intenta de nuevo.\n');
      } else {
        break;
      }
    }
  }

  rl.close();

  console.log('\n⏳ Conectando a la base de datos...');

  const rawUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
  let dbConfig;
  if (rawUrl) {
    const u = new URL(rawUrl);
    dbConfig = {
      host:     u.hostname,
      port:     parseInt(u.port) || 3306,
      user:     decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ''),
    };
  } else {
    dbConfig = {
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '3306'),
      database: process.env.DB_NAME     || 'ambulancia_db',
      user:     process.env.DB_USER     || 'root',
      password: process.env.DB_PASSWORD || '',
    };
  }

  const conn = await mysql.createConnection(dbConfig);

  try {
    // Verificar que no existe ese username
    const [existing] = await conn.execute(
      'SELECT id FROM users WHERE username = ? OR dni = ?', [username, dni]
    );
    if (existing.length > 0) {
      console.error('\n✗  Ya existe un usuario con ese username o DNI.\n');
      process.exit(1);
    }

    console.log(`⏳ Generando hash bcrypt (${BCRYPT_ROUNDS} rounds)...`);
    const salt         = await bcrypt.genSalt(BCRYPT_ROUNDS);
    const passwordHash = await bcrypt.hash(password, salt);

    // Obtener ID del rol administrador
    const [roleRows] = await conn.execute(
      'SELECT id FROM roles WHERE nombre = ?', ['administrador']
    );
    if (!roleRows.length) {
      console.error('\n✗  Rol "administrador" no encontrado. Ejecuta primero: seed.sql\n');
      process.exit(1);
    }
    const roleId = roleRows[0].id;

    // Insertar usuario
    const [result] = await conn.execute(
      `INSERT INTO users (username, password_hash, email, nombre, apellidos, dni)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [username, passwordHash, email, nombre, apellidos, dni]
    );
    const userId = result.insertId;

    // Asignar rol administrador
    await conn.execute(
      'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
      [userId, roleId]
    );

    console.log('\n✅ Usuario administrador creado correctamente:');
    console.log(`   ID:       ${userId}`);
    console.log(`   Username: ${username}`);
    console.log(`   Nombre:   ${nombre} ${apellidos}`);
    console.log(`   Rol:      administrador\n`);

  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('\n✗  Error:', err.message);
  process.exit(1);
});
