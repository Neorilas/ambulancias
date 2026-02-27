#!/usr/bin/env node
/**
 * scripts/setup-db.js
 * Ejecuta schema.sql y seed.sql para inicializar la base de datos
 *
 * Uso: node scripts/setup-db.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mysql = require('mysql2/promise');
const fs    = require('fs');
const path  = require('path');

const SCHEMA_PATH = path.join(__dirname, '../../database/schema.sql');
const SEED_PATH   = path.join(__dirname, '../../database/seed.sql');

async function runSQLFile(conn, filePath) {
  const sql       = fs.readFileSync(filePath, 'utf8');
  // Dividir por ; pero ignorar los DELIMITERs → ejecutar cada statement por separado
  // Para simplicidad, ejecutamos el archivo completo con multipleStatements: true
  await conn.query(sql);
  console.log(`  ✓ Ejecutado: ${path.basename(filePath)}`);
}

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   SETUP BASE DE DATOS - AMBULANCIAS        ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const conn = await mysql.createConnection({
    host:               process.env.DB_HOST     || 'localhost',
    port:               process.env.DB_PORT     || 3306,
    database:           process.env.DB_NAME     || 'ambulancia_db',
    user:               process.env.DB_USER     || 'root',
    password:           process.env.DB_PASSWORD || '',
    multipleStatements: true, // necesario para ejecutar el archivo SQL completo
  });

  try {
    console.log('⏳ Ejecutando schema.sql...');
    await runSQLFile(conn, SCHEMA_PATH);

    console.log('⏳ Ejecutando seed.sql...');
    await runSQLFile(conn, SEED_PATH);

    console.log('\n✅ Base de datos inicializada correctamente.');
    console.log('\n   Próximo paso: node scripts/create-admin.js\n');
  } catch (err) {
    console.error('\n✗  Error:', err.message);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main();
