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
 * Modo ruta (2026-10-19): ¿se puede trazar el recorrido de un servicio con lo
 * que guarda Cartrack, sin guardar nosotros ni una posición? Pide
 * `/vehicles/events` de una ventana (máx. 24 h, lo que deja la API) y cuenta,
 * por vehículo, cuántos puntos con coordenadas hay y cada cuánto llegan
 * mientras se mueve. Huecos de minutos o saltos de kilómetros = la ruta sale
 * a tramos rectos; un punto cada pocos segundos = se puede pintar.
 *   node scripts/sonda-cartrack.js --ruta                      (todos, últimas 24 h)
 *   node scripts/sonda-cartrack.js --ruta 7740MZB              (solo esa matrícula)
 *   node scripts/sonda-cartrack.js --ruta 7740MZB --desde "2026-10-18 08:00" --horas 6
 *   (+ --crudo vuelca el primer evento tal cual)
 * Las horas son de España: la API las toma en la zona de la cuenta.
 *
 * No escribe nada, ni en Cartrack ni en la base de datos. La conexión a MySQL
 * es opcional: sin ella sigue valiendo para ver los campos.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mysql = require('mysql2/promise');
const { normalizarMatricula, extraerMatricula } = require('../src/utils/matricula.utils');
const { normalizarVehiculo, extraerLista } = require('../src/services/cartrack.service');

const BASE_URL = (process.env.CARTRACK_BASE_URL || 'https://fleetapi-es.cartrack.com/rest').replace(/\/+$/, '');
const USUARIO  = process.env.CARTRACK_USER || '';
const CLAVE    = process.env.CARTRACK_KEY  || '';
const CRUDO    = process.argv.includes('--crudo');
const RUTA     = process.argv.includes('--ruta');

/** Valor que va detrás de un flag (`--horas 6`), o null. */
function argumento(flag) {
  const i = process.argv.indexOf(flag);
  const v = i >= 0 ? process.argv[i + 1] : null;
  return v && !v.startsWith('--') ? v : null;
}

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

// ============================================================
// Modo ruta: ¿da Cartrack puntos suficientes para pintar un recorrido?
// ============================================================

/** 'YYYY-MM-DD HH:MM:SS' en hora de España, que es como lo quiere la API. */
function enHoraEspana(instante) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instante).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second}`;
}

async function pedirJson(ruta) {
  const res = await fetch(`${BASE_URL}${ruta}`, {
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${USUARIO}:${CLAVE}`).toString('base64'),
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Distancia en km entre dos puntos (haversine). */
function km(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function percentil(valores, p) {
  if (!valores.length) return null;
  const orden = [...valores].sort((x, y) => x - y);
  return orden[Math.min(orden.length - 1, Math.floor((p / 100) * orden.length))];
}

/**
 * El instante del evento. El OpenAPI no lo documenta en `vehicle-event-base`;
 * la cuenta real lo manda en `event_ts` como '2026-10-19 10:24:19+02', con la
 * zona SIN minutos, que `Date.parse` rechaza: hay que completarla a '+02:00'.
 * Se dejan otros nombres por si la API cambia, y si no está ninguno la sonda
 * lo dice en vez de inventarse un orden.
 */
const CAMPOS_HORA = ['event_ts', 'event_timestamp', 'timestamp', 'event_time', 'gps_time'];
function horaDelEvento(e) {
  for (const c of CAMPOS_HORA) {
    if (e[c]) {
      const t = Date.parse(String(e[c]).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
      if (Number.isFinite(t)) return t;
    }
  }
  return null;
}

async function mainRuta() {
  linea('=== Sonda Cartrack · modo ruta ===');
  linea('');
  if (!USUARIO || !CLAVE) {
    linea('Faltan CARTRACK_USER / CARTRACK_KEY en backend/.env.');
    process.exitCode = 1;
    return;
  }

  const filtro = argumento('--ruta');
  const horas = Math.min(24, Math.max(1, Number(argumento('--horas')) || 24));
  const desdeArg = argumento('--desde');
  // --desde se lee como hora de España: se le resta el desfase de ese día.
  let desde;
  if (desdeArg) {
    const provisional = new Date(`${desdeArg.replace(' ', 'T')}Z`);
    const desfase = new Date(enHoraEspana(provisional).replace(' ', 'T') + 'Z') - provisional;
    desde = new Date(provisional.getTime() - desfase);
  } else {
    desde = new Date(Date.now() - horas * 3600 * 1000);
  }
  const hasta = new Date(desde.getTime() + horas * 3600 * 1000);

  linea(`Ventana: ${enHoraEspana(desde)} → ${enHoraEspana(hasta)} (hora de España, ${horas} h)`);
  linea(`Vehículo: ${filtro ? normalizarMatricula(filtro) : 'todos'}`);
  linea('');

  // Paginado a 1000, el máximo. Tope de 50 páginas para no comerse el cupo
  // si un día la flota entera manda un evento por segundo.
  const eventos = [];
  let total = null;
  for (let pagina = 1; pagina <= 50; pagina += 1) {
    const qs = new URLSearchParams({
      start_timestamp: enHoraEspana(desde),
      end_timestamp: enHoraEspana(hasta),
      limit: '1000',
      page: String(pagina),
    });
    let cuerpo;
    try {
      cuerpo = await pedirJson(`/vehicles/events?${qs}`);
    } catch (err) {
      linea(`← error en la página ${pagina}: ${err.message}`);
      process.exitCode = 1;
      break;
    }
    const filas = extraerLista(cuerpo);
    total = cuerpo?.meta?.total ?? total;
    eventos.push(...filas);
    const ultima = cuerpo?.meta?.last_page;
    if (!filas.length || (ultima && pagina >= ultima)) break;
  }
  linea(`Eventos recibidos: ${eventos.length}${total !== null ? ` (la API dice total=${total})` : ''}`);
  if (!eventos.length) return;

  linea('');
  linea('--- Campos del primer evento ---');
  for (const c of claves(eventos[0])) linea(`  ${c}`);
  if (CRUDO) {
    linea('');
    linea(JSON.stringify(eventos[0], null, 2));
  }
  if (horaDelEvento(eventos[0]) === null) {
    linea('');
    linea(`  AVISO: ningún campo de hora reconocido (${CAMPOS_HORA.join(', ')}).`);
    linea('  Sin hora no se puede ordenar el recorrido: mirar la lista de campos de arriba.');
  }

  // Los tipos dicen si hay pings periódicos de posición o solo eventos
  // sueltos (contacto, frenazo…), que no dan para una ruta.
  const tipos = new Map();
  for (const e of eventos) {
    const t = `${e.terminal_event_type_id ?? '?'} ${e.event_description ?? ''}`.trim();
    tipos.set(t, (tipos.get(t) || 0) + 1);
  }
  linea('');
  linea('--- Tipos de evento ---');
  for (const [t, n] of [...tipos].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    linea(`  ${String(n).padStart(6)}  ${t}`);
  }

  const porVehiculo = new Map();
  for (const e of eventos) {
    const mat = extraerMatricula(e.registration) || normalizarMatricula(e.registration);
    if (filtro && mat !== normalizarMatricula(filtro)) continue;
    if (!porVehiculo.has(mat)) porVehiculo.set(mat, { nombre: e.registration, puntos: [], sinCoords: 0 });
    const v = porVehiculo.get(mat);
    const lat = Number(e.latitude);
    const lon = Number(e.longitude);
    const t = horaDelEvento(e);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0) || t === null) {
      v.sinCoords += 1;
    } else {
      v.puntos.push({ lat, lon, t, speed: Number(e.speed) || 0 });
    }
  }

  linea('');
  linea('--- Por vehículo (huecos solo en marcha: algún extremo a > 3 km/h) ---');
  linea('  vehículo              puntos sin-coord     km  hueco-mediano    p90    máx  saltos>1km');
  let enMarcha = 0;
  let buenos = 0;
  for (const v of [...porVehiculo.values()].sort((a, b) => b.puntos.length - a.puntos.length)) {
    v.puntos.sort((a, b) => a.t - b.t);
    const huecos = [];
    let saltos = 0;
    let recorrido = 0;
    for (let i = 1; i < v.puntos.length; i += 1) {
      const a = v.puntos[i - 1];
      const b = v.puntos[i];
      const d = km(a, b);
      recorrido += d;
      if (a.speed > 3 || b.speed > 3) {
        huecos.push((b.t - a.t) / 1000);
        if (d > 1) saltos += 1;
      }
    }
    const seg = (x) => (x === null ? '-' : `${Math.round(x)} s`).padStart(6);
    const mediano = percentil(huecos, 50);
    linea(`  ${String(v.nombre).slice(0, 20).padEnd(20)} ${String(v.puntos.length).padStart(7)} ${String(v.sinCoords).padStart(9)} ${recorrido.toFixed(1).padStart(6)}  ${seg(mediano).padStart(13)} ${seg(percentil(huecos, 90))} ${seg(huecos.length ? Math.max(...huecos) : null)}  ${String(saltos).padStart(10)}`);
    if (huecos.length >= 10) {
      enMarcha += 1;
      if (mediano <= 60 && saltos <= huecos.length * 0.05) buenos += 1;
    }
  }

  linea('');
  linea('--- Veredicto ---');
  if (!enMarcha) {
    linea('  Ningún vehículo se movió lo bastante en la ventana para juzgar. Probar otra (--desde / --horas).');
    return;
  }
  linea(`  ${buenos} de ${enMarcha} vehículos en marcha tienen un punto cada ≤ 60 s y < 5 % de saltos > 1 km.`);
  linea(buenos === enMarcha
    ? '  → Con /vehicles/events se puede trazar la ruta.'
    : '  → En algunos la ruta saldría a tramos rectos: mirar la tabla.');
}

(RUTA ? mainRuta : main)().catch((err) => {
  console.error(`Sonda: ${err.message}`);
  process.exitCode = 1;
});
