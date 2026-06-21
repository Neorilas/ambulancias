#!/usr/bin/env node
/**
 * scripts/create-user.js
 * Crea (o actualiza) un usuario con uno o varios roles de forma NO interactiva.
 * Pensado para ejecutarse en el servidor con acceso a la BD de producción.
 *
 * Uso:
 *   node scripts/create-user.js \
 *     --username rafa \
 *     --nombre Rafa --apellidos "Apellido Apellido" \
 *     --dni 00000000A \
 *     --roles tecnico,administrador \
 *     [--password "MiClave.2026"]   # si se omite, se genera una segura
 *     [--email rafa@ejemplo.com]
 *     [--reset]                     # si el usuario ya existe, resetea su contraseña
 *
 * En Docker:
 *   docker compose exec backend node scripts/create-user.js --username rafa ...
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const crypto = require('crypto');
const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;

// ── Parseo de argumentos --clave valor / --flag ───────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else { out[key] = true; }
    }
  }
  return out;
}

// ── Genera una contraseña que cumple la política del sistema ──
function generatePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digit = '23456789';
  const spec  = '!@#$%&*.';
  const all   = upper + lower + digit + spec;
  const pick  = set => set[crypto.randomInt(set.length)];
  let pw = pick(upper) + pick(lower) + pick(digit) + pick(spec);
  for (let i = 0; i < 8; i++) pw += pick(all);
  // mezclar
  return pw.split('').sort(() => crypto.randomInt(3) - 1).join('');
}

function dbConfig() {
  const rawUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (rawUrl && !rawUrl.includes('{{')) {
    const u = new URL(rawUrl);
    return {
      host: u.hostname,
      port: parseInt(u.port) || 3306,
      user: decodeURIComponent(u.username),
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
  const args = parseArgs(process.argv.slice(2));

  const username  = (args.username || '').trim();
  const nombre    = (args.nombre    || '').trim();
  const apellidos = (args.apellidos || '').trim();
  const dni       = (args.dni       || '').trim();
  const email     = (args.email     || null);
  const roles     = (args.roles || '').split(',').map(r => r.trim()).filter(Boolean);
  const reset     = !!args.reset;
  const password  = (typeof args.password === 'string' && args.password) || generatePassword();

  if (!username || !nombre || !apellidos || !dni || roles.length === 0) {
    console.error('\n✗  Faltan argumentos. Requeridos: --username --nombre --apellidos --dni --roles');
    console.error('   Ej: node scripts/create-user.js --username rafa --nombre Rafa --apellidos "X Y" --dni 00000000A --roles tecnico,administrador\n');
    process.exit(1);
  }

  const conn = await mysql.createConnection(dbConfig());
  try {
    // Resolver IDs de roles
    const [roleRows] = await conn.query(
      'SELECT id, nombre FROM roles WHERE nombre IN (?)', [roles]
    );
    const found = roleRows.map(r => r.nombre);
    const missing = roles.filter(r => !found.includes(r));
    if (missing.length) {
      console.error(`\n✗  Roles inexistentes: ${missing.join(', ')}`);
      console.error(`   Roles disponibles: ${(await conn.query('SELECT nombre FROM roles'))[0].map(r => r.nombre).join(', ')}\n`);
      process.exit(1);
    }

    const passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(BCRYPT_ROUNDS));

    // ¿Existe ya?
    const [existing] = await conn.query('SELECT id FROM users WHERE username = ?', [username]);
    let userId;

    if (existing.length) {
      userId = existing[0].id;
      if (!reset) {
        console.error(`\n✗  El usuario "${username}" ya existe (id ${userId}). Usa --reset para resetear su contraseña y reasignar roles.\n`);
        process.exit(1);
      }
      await conn.query('UPDATE users SET password_hash = ?, activo = 1 WHERE id = ?', [passwordHash, userId]);
      console.log(`\n♻  Usuario existente actualizado (id ${userId}).`);
    } else {
      const [res] = await conn.query(
        `INSERT INTO users (username, password_hash, email, nombre, apellidos, dni)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [username, passwordHash, email, nombre, apellidos, dni]
      );
      userId = res.insertId;
      console.log(`\n✅ Usuario creado (id ${userId}).`);
    }

    // Reasignar roles (limpia y vuelve a poner los indicados)
    await conn.query('DELETE FROM user_roles WHERE user_id = ?', [userId]);
    for (const r of roleRows) {
      await conn.query('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, r.id]);
    }

    console.log('\n────────────── CREDENCIALES ──────────────');
    console.log(`  Usuario:    ${username}`);
    console.log(`  Contraseña: ${password}`);
    console.log(`  Roles:      ${found.join(', ')}`);
    console.log('──────────────────────────────────────────');
    console.log('  (Anótala ahora: la contraseña no se puede recuperar después)\n');
  } finally {
    await conn.end();
  }
}

main().catch(err => { console.error('\n✗  Error:', err.message); process.exit(1); });
