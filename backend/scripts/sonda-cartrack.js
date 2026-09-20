#!/usr/bin/env node
/**
 * scripts/sonda-cartrack.js
 * Fase 0 del plan del mapa de flota: comprobar la API de Cartrack ANTES de
 * fiarse de ella.
 *
 * Qué contesta, que es justo lo que no se puede deducir leyendo documentación:
 *   1. ¿Las credenciales y la región son las buenas? (la URL de otro país da 401)
 *   2. ¿Cómo se llaman de verdad los campos? El contrato se sacó del OpenAPI
 *      oficial, no de una llamada real contra NUESTRA cuenta.
 *   3. ¿Cuántas matrículas cruzan con la tabla `vehicles`? Si cruzan pocas, el
 *      problema está en nuestros datos, no en el mapa — al dar de alta la flota
 *      se metió el nombre de la ambulancia en el campo `matricula` y la
 *      migración v14 solo deshizo los casos sin ambigüedad.
 *
 * Uso:
 *   cd backend && node scripts/sonda-cartrack.js
 *   cd backend && node scripts/sonda-cartrack.js --crudo   (vuelca la 1ª fila tal cual)
 *
 * No escribe nada, ni en Cartrack ni en la base de datos. La conexión a MySQL
 * es opcional: sin ella sigue valiendo para ver los campos.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mysql = require('mysql2/promise');
const { normalizarMatricula } = require('../src/utils/matricula.utils');
const { normalizarVehiculo, extraerLista } = require('../src/services/cartrack.service');

const BASE_URL = (process.env.CARTRACK_BASE_URL || 'https://fleetapi-es.cartrack.com/rest').replace(/\/+$/, '');
const USUARIO  = process.env.CARTRACK_USER || '';
const CLAVE    = process.env.CARTRACK_KEY  || '';
const CRUDO    = process.argv.includes('--crudo');

function linea(t = '') { console.log(t); }

async function pedir() {
  const url = `${BASE_URL}/vehicles/status`;
  linea(`→ GET ${url}`);
  linea(`  usuario: ${USUARIO.slice(0, 4)}…  (la clave no se imprime)`);

  const res = await fetch(url, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${USUARIO}:${CLAVE}`).toString('base64'),
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  });

  linea(`← ${res.status} ${res.statusText}`);
  if (res.status === 401) {
    linea('');
    linea('  401 = credenciales rechazadas O región equivocada.');
    linea(`  Comprueba CARTRACK_USER/CARTRACK_KEY y que la URL sea la de España`);
    linea('  (https://fleetapi-es.cartrack.com/rest).');
    process.exitCode = 1;
    return null;
  }
  if (!res.ok) {
    linea(`  Cuerpo: ${(await res.text()).slice(0, 400)}`);
    process.exitCode = 1;
    return null;
  }
  return res.json();
}

/** Las claves de un objeto, anidadas incluidas, para ver qué manda de verdad. */
function claves(obj, prefijo = '', salida = []) {
  for (const [k, v] of Object.entries(obj || {})) {
    const ruta = prefijo ? `${prefijo}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) claves(v, ruta, salida);
    else salida.push(`${ruta}: ${JSON.stringify(v)}`);
  }
  return salida;
}

async function matriculasDeLaApp() {
  if (!process.env.DB_HOST) return null;
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
    const [rows] = await conn.query(
      'SELECT id, matricula, alias FROM vehicles WHERE deleted_at IS NULL'
    );
    await conn.end();
    return rows;
  } catch (err) {
    linea(`  (sin base de datos: ${err.message})`);
    return null;
  }
}

async function main() {
  linea('=== Sonda Cartrack ===');
  linea('');

  if (!USUARIO || !CLAVE) {
    linea('Faltan CARTRACK_USER / CARTRACK_KEY en backend/.env.');
    linea('Las credenciales NO van al repositorio: este repo es público.');
    process.exitCode = 1;
    return;
  }

  const cuerpo = await pedir();
  if (!cuerpo) return;

  const filas = extraerLista(cuerpo);
  linea('');
  linea(`Vehículos devueltos: ${filas.length}`);
  if (!filas.length) {
    linea('La respuesta no traía lista. Envoltorio recibido:');
    linea(JSON.stringify(cuerpo).slice(0, 600));
    return;
  }

  linea('');
  linea('--- Campos de la primera fila (lo que manda Cartrack de verdad) ---');
  for (const c of claves(filas[0])) linea(`  ${c}`);

  if (CRUDO) {
    linea('');
    linea('--- Fila cruda ---');
    linea(JSON.stringify(filas[0], null, 2));
  }

  linea('');
  linea('--- Cómo lo interpreta cartrack.service ---');
  const normalizado = normalizarVehiculo(filas[0]);
  for (const [k, v] of Object.entries(normalizado)) {
    const aviso = v === null ? '   ← NULL: revisa el alias del campo en `leer()`' : '';
    linea(`  ${k.padEnd(18)} ${JSON.stringify(v)}${aviso}`);
  }

  // ── El cruce ────────────────────────────────────────────────
  const nuestros = await matriculasDeLaApp();
  if (!nuestros) {
    linea('');
    linea('Sin conexión a la BD: no se comprueba el cruce de matrículas.');
    return;
  }

  const setNuestras = new Map(nuestros.map(v => [normalizarMatricula(v.matricula), v]));
  const delGps = filas.map(normalizarVehiculo);

  const cruzan    = delGps.filter(g => g.matricula && setNuestras.has(g.matricula));
  const soloGps   = delGps.filter(g => !g.matricula || !setNuestras.has(g.matricula));
  const vistas    = new Set(cruzan.map(g => g.matricula));
  const soloApp   = nuestros.filter(v => !vistas.has(normalizarMatricula(v.matricula)));

  linea('');
  linea('--- Cruce por matrícula ---');
  linea(`  Vehículos en la app:      ${nuestros.length}`);
  linea(`  Vehículos con GPS:        ${delGps.length}`);
  linea(`  CRUZAN:                   ${cruzan.length}`);
  linea(`  GPS sin vehículo nuestro: ${soloGps.length}`);
  linea(`  Nuestros sin GPS:         ${soloApp.length}`);

  if (soloApp.length) {
    linea('');
    linea('  Nuestros sin GPS (¿matrícula mal escrita en la ficha?):');
    for (const v of soloApp.slice(0, 30)) {
      linea(`    #${v.id} ${String(v.matricula).padEnd(10)} ${v.alias || ''}`);
    }
    if (soloApp.length > 30) linea(`    … y ${soloApp.length - 30} más`);
  }
  if (soloGps.length) {
    linea('');
    linea('  GPS que no tenemos dados de alta:');
    for (const g of soloGps.slice(0, 30)) {
      linea(`    ${String(g.matriculaOriginal || '(sin matrícula)').padEnd(12)} id=${g.cartrackId}`);
    }
    if (soloGps.length > 30) linea(`    … y ${soloGps.length - 30} más`);
  }
}

main().catch((err) => {
  console.error(`Sonda: ${err.message}`);
  process.exitCode = 1;
});
