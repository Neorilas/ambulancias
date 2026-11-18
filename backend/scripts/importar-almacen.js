#!/usr/bin/env node
/**
 * scripts/importar-almacen.js
 * Importa el AppSheet «AmbulanciaDB» (inventario del almacén) a las tablas
 * material_* (v44). La lógica está en src/services/importacionAlmacen.service.js.
 *
 * Uso:
 *   node scripts/importar-almacen.js <carpeta> [--aplicar]
 *
 * <carpeta> tiene los tres CSV de la hoja (en Google Sheets: Archivo →
 * Descargar → CSV, una vez por pestaña): su nombre tiene que contener
 * «Productos», «Stock» y «Movimientos». Esos CSV llevan emails y datos de la
 * empresa: NUNCA dentro del repo (es público).
 *
 * Sin --aplicar es un ENSAYO: hace todo dentro de una transacción, enseña el
 * informe y deshace. Con --aplicar, lo guarda. Se puede repetir: lo ya
 * importado se actualiza por su id del AppSheet, no se duplica.
 *
 * Usa la BD del entorno (backend/.env en local; en PRO, dentro del contenedor
 * del backend, que ya tiene las variables).
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');
const { preparar, escribir } = require('../src/services/importacionAlmacen.service');

function buscar(carpeta, nombre) {
  const fichero = fs.readdirSync(carpeta)
    .find(f => f.toLowerCase().endsWith('.csv') && f.toLowerCase().includes(nombre.toLowerCase()));
  if (!fichero) throw new Error(`No hay ningún CSV con «${nombre}» en el nombre dentro de ${carpeta}`);
  return fs.readFileSync(path.join(carpeta, fichero), 'utf8');
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--aplicar');
  const carpeta = args.find(a => !a.startsWith('--'));
  if (!carpeta) {
    console.error('Uso: node scripts/importar-almacen.js <carpeta con los CSV> [--aplicar]');
    process.exit(1);
  }

  const csv = {
    productos:   buscar(carpeta, 'Productos'),
    stock:       buscar(carpeta, 'Stock'),
    movimientos: buscar(carpeta, 'Movimientos'),
  };

  const conn = await pool.getConnection();
  try {
    const [tablas] = await conn.query("SHOW TABLES LIKE 'material_movimientos'");
    if (!tablas.length) throw new Error('No existe material_movimientos: arranca antes el backend para que aplique la migración v44');

    const [ambulancias] = await conn.query('SELECT id, alias, matricula FROM vehicles WHERE deleted_at IS NULL');
    const [usuarios] = await conn.query('SELECT id, email FROM users WHERE deleted_at IS NULL');
    const datos = preparar(csv, { ambulancias, usuarios });

    await conn.beginTransaction();
    const r = await escribir(conn, datos);
    if (aplicar) await conn.commit();
    else await conn.rollback();

    console.log(`\n${aplicar ? 'IMPORTADO' : 'ENSAYO (no se ha guardado nada; repite con --aplicar)'}\n`);
    console.log(`  Productos:   ${r.productos}`);
    console.log(`  Lotes:       ${r.lotes}`);
    console.log(`  Movimientos: ${r.movimientos}${r.borrados ? ` (y ${r.borrados} importados antes que ya no están en la hoja, borrados)` : ''}`);

    if (datos.rechazos.length) {
      console.log(`\n  Filas descartadas (${datos.rechazos.length}): corrígelas en el AppSheet y repite`);
      for (const x of datos.rechazos) console.log(`    · ${x.hoja}, fila ${x.fila}: ${x.motivo}`);
    }
    const sinAmb = Object.entries(datos.avisos.sinAmbulancia);
    if (sinAmb.length) {
      console.log('\n  Destinos que no casan con ninguna ambulancia (se guardan con el texto, sin enlazar):');
      for (const [d, n] of sinAmb) console.log(`    · ${d}: ${n}`);
    }
    const sinUsr = Object.entries(datos.avisos.sinUsuario);
    if (sinUsr.length) {
      console.log('\n  Usuarios del AppSheet sin cuenta en la app con ese email (se guarda el email):');
      for (const [e, n] of sinUsr) console.log(`    · ${e}: ${n} movimientos`);
    }
    if (datos.avisos.lotesReconstruidos.length) {
      console.log(`\n  Lotes borrados de Stock y rehechos desde su clave (producto-fecha), para no perder sus movimientos: ${datos.avisos.lotesReconstruidos.length}`);
    }
    if (datos.avisos.nombresRepetidos.length) {
      console.log(`\n  Productos con el nombre repetido: ${datos.avisos.nombresRepetidos.join(', ')}`);
    }
    if (r.negativos.length) {
      console.log(`\n  Lotes que quedan en negativo (${r.negativos.length}): más salidas que entradas en la hoja; se arreglan con un recuento en la app`);
      for (const n of r.negativos) console.log(`    · ${n.nombre} (${n.caducidad || 'sin caducidad'}, lote ${n.lote}): ${n.stock}`);
    }
    console.log('');
  } catch (err) {
    try { await conn.rollback(); } catch { /* sin transacción abierta */ }
    console.error(`\n✗  ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
