#!/usr/bin/env node
/**
 * scripts/seed-local.js
 * Llena la base de datos LOCAL con datos con los que se pueda probar de
 * verdad: usuarios de cada rol, flota y un par de asignaciones.
 *
 * Uso:
 *   cd backend && npm run seed:local
 *
 * Es idempotente: se puede ejecutar las veces que haga falta. Los usuarios se
 * reutilizan por username y los vehiculos por matricula.
 *
 * Requiere que el backend haya arrancado al menos una vez contra esta BD: las
 * migraciones (asignaciones_libres, permisos, superadmin...) las aplica el al
 * arrancar, no este script.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const PASSWORD      = process.env.SEED_PASSWORD || 'Local.2026';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 4;

// ============================================================
// Guarda: esto SOLO puede correr contra la BD local
// ============================================================
// El script crea usuarios con contraseña conocida. Si por un despiste apuntara
// al .env de producción, dejaría cuentas abiertas con una clave publicada en
// el repositorio. Antes de conectarse comprueba que el destino es local por
// partida triple; si algo no cuadra, aborta sin abrir la conexión.
function comprobarQueEsLocal() {
  const host   = process.env.DB_HOST || 'localhost';
  const dbName = process.env.DB_NAME || '';
  const appEnv = process.env.APP_ENV || '';
  const motivos = [];

  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    motivos.push(`DB_HOST es "${host}" y no apunta a esta máquina`);
  }
  if (!/local/i.test(dbName)) {
    motivos.push(`DB_NAME es "${dbName}" y no contiene "local"`);
  }
  if (appEnv !== 'local') {
    motivos.push(`APP_ENV es "${appEnv}" y no "local"`);
  }
  if (process.env.MYSQL_URL || process.env.DATABASE_URL) {
    motivos.push('hay un MYSQL_URL/DATABASE_URL definido (eso es de otro entorno)');
  }

  if (motivos.length) {
    console.error('\n✗  Este script solo puede sembrar la base de datos LOCAL.\n');
    motivos.forEach(m => console.error(`   · ${m}`));
    console.error('\n   Copia backend/.env.local.example a backend/.env y reinténtalo.\n');
    process.exit(1);
  }
}

// ============================================================
// Datos
// ============================================================

// El rol `superadmin` se le da aqui a mano a proposito: la migracion v3 lo
// asigna al usuario id=1, pero en una base nueva corre antes de que exista
// ningun usuario, queda marcada como aplicada y nadie lo recibe. Sin esto el
// panel /admin (auditoria y logs de error) no se puede probar en local.
const USUARIOS = [
  { username: 'admin',     nombre: 'Ana',     apellidos: 'Admin Local',     dni: '00000001A', roles: ['administrador', 'superadmin'] },
  { username: 'gestor',    nombre: 'Gonzalo', apellidos: 'Gestor Local',    dni: '00000002B', roles: ['gestor'] },
  { username: 'tecnico',   nombre: 'Tomás',   apellidos: 'Técnico Local',   dni: '00000003C', roles: ['tecnico'] },
  { username: 'tecnico2',  nombre: 'Teresa',  apellidos: 'Técnica Local',   dni: '00000004D', roles: ['tecnico'] },
  { username: 'enfermero', nombre: 'Elena',   apellidos: 'Enfermera Local', dni: '00000005E', roles: ['enfermero'] },
  { username: 'tes',       nombre: 'Teo',     apellidos: 'TES Local',       dni: '00000006F', roles: ['tes_conductor'] },
];

const VEHICULOS = [
  { matricula: '1111AAA', alias: 'Ambulancia 01', km: 84200,  itv: '2026-04-12', its: '2026-05-30', tarjeta: '2027-01-15' },
  { matricula: '2222BBB', alias: 'Ambulancia 02', km: 41850,  itv: '2026-02-03', its: '2026-06-18', tarjeta: '2026-10-01' },
  { matricula: '3333CCC', alias: 'UVI Móvil 01',  km: 12390,  itv: '2026-07-21', its: '2026-07-21', tarjeta: '2028-03-09' },
  // Con la tarjeta de transporte caducando pronto: sirve para ver los avisos.
  { matricula: '4444DDD', alias: 'Ambulancia 03', km: 156700, itv: '2025-11-30', its: '2026-01-14', tarjeta: '2026-09-30' },
];

function dbConfig() {
  return {
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };
}

async function main() {
  comprobarQueEsLocal();

  const conn = await mysql.createConnection(dbConfig());
  try {
    // ── Las migraciones tienen que estar aplicadas ──────────────────────────
    const [tablas] = await conn.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'asignaciones_libres'`
    );
    if (!tablas.length) {
      console.error('\n✗  Falta la tabla `asignaciones_libres`.');
      console.error('   Arranca el backend una vez (cd backend && npm run dev): las migraciones');
      console.error('   se aplican al arrancar. Luego vuelve a ejecutar este script.\n');
      process.exit(1);
    }

    // ── Usuarios ────────────────────────────────────────────────────────────
    const hash = await bcrypt.hash(PASSWORD, await bcrypt.genSalt(BCRYPT_ROUNDS));
    const ids  = {};

    for (const u of USUARIOS) {
      const [existe] = await conn.query('SELECT id FROM users WHERE username = ?', [u.username]);
      if (existe.length) {
        ids[u.username] = existe[0].id;
        await conn.query(
          'UPDATE users SET password_hash = ?, activo = 1, deleted_at = NULL WHERE id = ?',
          [hash, existe[0].id]
        );
      } else {
        const [res] = await conn.query(
          `INSERT INTO users (username, password_hash, email, nombre, apellidos, dni)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [u.username, hash, `${u.username}@local.test`, u.nombre, u.apellidos, u.dni]
        );
        ids[u.username] = res.insertId;
      }

      const [roles] = await conn.query('SELECT id, nombre FROM roles WHERE nombre IN (?)', [u.roles]);
      for (const r of roles) {
        await conn.query(
          'INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
          [ids[u.username], r.id]
        );
      }
    }

    // ── Flota ───────────────────────────────────────────────────────────────
    const vehIds = {};
    for (const v of VEHICULOS) {
      const [existe] = await conn.query('SELECT id FROM vehicles WHERE matricula = ?', [v.matricula]);
      if (existe.length) {
        vehIds[v.matricula] = existe[0].id;
      } else {
        const [res] = await conn.query(
          `INSERT INTO vehicles
             (matricula, alias, kilometros_actuales, fecha_itv, fecha_its, fecha_tarjeta_transporte)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [v.matricula, v.alias, v.km, v.itv, v.its, v.tarjeta]
        );
        vehIds[v.matricula] = res.insertId;
      }
    }

    // ── Asignaciones ────────────────────────────────────────────────────────
    // Una activa (el técnico la ve nada más entrar) y una programada para
    // mañana (sirve para probar la auto-activación del cron).
    const [yaHay] = await conn.query(
      'SELECT COUNT(*) AS c FROM asignaciones_libres WHERE deleted_at IS NULL'
    );

    if (yaHay[0].c === 0) {
      const adminId = ids['admin'];
      await conn.query(
        `INSERT INTO asignaciones_libres
           (vehicle_id, user_id, created_by, fecha_inicio, fecha_fin, estado, km_inicio, notas)
         VALUES (?, ?, ?, NOW() - INTERVAL 2 HOUR, NOW() + INTERVAL 6 HOUR, 'activa', ?, ?)`,
        [vehIds['1111AAA'], ids['tecnico'], adminId, 84200, 'Asignación de prueba en curso']
      );
      await conn.query(
        `INSERT INTO asignaciones_libres
           (vehicle_id, user_id, created_by, fecha_inicio, fecha_fin, estado, notas)
         VALUES (?, ?, ?, CURDATE() + INTERVAL 1 DAY, CURDATE() + INTERVAL 1 DAY + INTERVAL 8 HOUR, 'programada', ?)`,
        [vehIds['2222BBB'], ids['tecnico2'], adminId, 'Programada: debe activarse sola al llegar la hora']
      );
    }

    // ── Resumen ─────────────────────────────────────────────────────────────
    const [[{ u }]] = await conn.query('SELECT COUNT(*) AS u FROM users WHERE deleted_at IS NULL');
    const [[{ v }]] = await conn.query('SELECT COUNT(*) AS v FROM vehicles WHERE deleted_at IS NULL');
    const [[{ a }]] = await conn.query('SELECT COUNT(*) AS a FROM asignaciones_libres WHERE deleted_at IS NULL');

    console.log('');
    console.log(`✅ Base local sembrada: ${u} usuarios, ${v} vehículos, ${a} asignaciones.`);
    console.log('');
    console.log('   Usuarios (todos con la misma contraseña):');
    for (const us of USUARIOS) {
      console.log(`     ${us.username.padEnd(10)} ${us.roles.join(', ')}`);
    }
    console.log('');
    console.log(`   Contraseña: ${PASSWORD}`);
    console.log('');
    console.log('   El usuario id=1 es superadmin por la migración v3: si "admin" fue el');
    console.log('   primero en crearse, tendrá también el panel /admin.');
    console.log('');
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('\n✗  Error sembrando la base local:', err.message, '\n');
  process.exit(1);
});
