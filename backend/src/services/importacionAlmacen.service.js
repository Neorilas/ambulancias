/**
 * services/importacionAlmacen.service.js
 * Importa el AppSheet «AmbulanciaDB» al almacén (v44). Lo lanza
 * scripts/importar-almacen.js con los tres CSV de la hoja.
 *
 * Se puede repetir: cada fila lleva su id del AppSheet en `codigo_origen` y se
 * actualiza en vez de duplicarse. Así se importa ahora para probar y se vuelve
 * a importar el día del cambio, con lo último. Mientras el AppSheet siga vivo
 * manda él: lo importado se sobrescribe, y los movimientos importados que ya
 * no están en la hoja se borran.
 *
 * Lo que la hoja tiene mal (visto el 2026-11-18, MAPA_CODIGO.md §2.10) se
 * descarta fila a fila y se cuenta en el informe, sin parar la importación:
 *  - IDStock NO siempre es `producto-MM/DD/YYYY`: muchos son un id aleatorio.
 *    El producto sale de la columna Producto y la caducidad de la columna
 *    Caducidad (dd/mm/yyyy), nunca de la clave.
 *  - «Sin caducidad» es una celda vacía o el 01/06/2099 de mentira → NULL.
 *  - Movimientos con un lote que no existe, sin lote o con la cantidad vacía o
 *    negativa: fuera, al informe.
 *  - El destino («UVI-03», «UVI-7») se busca entre las ambulancias por alias o
 *    matrícula; si no casa, la salida se guarda igual con el texto en
 *    `destino` y sin vehículo, y sale en el informe.
 *  - El usuario es un email de Google: se enlaza con el usuario de la app que
 *    tenga ese email, o se guarda el email en `usuario_origen`.
 */

'use strict';

const { instanteEnEspana } = require('../utils/fecha.utils');

/**
 * CSV a filas (array de arrays). Comillas dobles con "" dentro, comas y saltos
 * de línea dentro de comillas, BOM al principio y finales \r\n.
 */
function parseCsv(texto) {
  const filas = [];
  let fila = [];
  let campo = '';
  let comillas = false;
  const s = String(texto).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (comillas) {
      if (c === '"' && s[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas;
}

/**
 * Filas del CSV como objetos por el nombre de su columna (recortado), sin las
 * filas vacías. Cada objeto lleva `_fila`, el número de fila en la hoja.
 */
function tabla(texto) {
  const [cabecera = [], ...resto] = parseCsv(texto);
  const nombres = cabecera.map(h => h.trim());
  const out = [];
  resto.forEach((valores, i) => {
    if (!valores.some(v => v.trim() !== '')) return;
    const o = { _fila: i + 2 };
    nombres.forEach((n, j) => { if (n) o[n] = (valores[j] ?? '').trim(); });
    out.push(o);
  });
  return out;
}

/** Primer valor no vacío de entre varias columnas posibles (los nombres llevan tildes). */
function col(fila, ...nombres) {
  for (const n of nombres) if (fila[n] !== undefined && fila[n] !== '') return fila[n];
  return '';
}

/** 'dd/mm/yyyy' → 'YYYY-MM-DD'; null si está vacía o es el 2099 de «no caduca»; undefined si no se entiende. */
function caducidadDeHoja(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (!m) return undefined;
  const [dia, mes, anio] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (anio >= 2099) return null;
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return undefined;
  return d.toISOString().slice(0, 10);
}

/** 'dd/mm/yyyy[ hh:mm[:ss]]' en hora española → instante (Date); null si no se entiende. */
function instanteDeHoja(v) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const n = m.slice(1).map(x => (x === undefined ? 0 : Number(x)));
  if (n[1] < 1 || n[1] > 12 || n[0] < 1 || n[0] > 31 || n[3] > 23) return null;
  return instanteEnEspana(n[2], n[1], n[0], n[3], n[4], n[5]);
}

/** «UVI-03», «uvi 3», «UVI3» → «UVI3»: para casar el destino con el alias de la ambulancia. */
function claveAmbulancia(v) {
  return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/([A-Z])0+(\d)/g, '$1$2');
}

/** Email en minúsculas; en Gmail los puntos no cuentan («ana.b@gmail.com» = «anab@gmail.com»). */
function claveEmail(v) {
  const e = String(v ?? '').trim().toLowerCase();
  const m = /^([^@]+)@(gmail\.com|googlemail\.com)$/.exec(e);
  return m ? `${m[1].replace(/\./g, '')}@gmail.com` : e;
}

const TIPOS = {
  entrada:          { tipo: 'entrada',           signo: 1 },
  'retirada uvi':   { tipo: 'salida_ambulancia', signo: -1 },
  'retirada otros': { tipo: 'salida_otros',      signo: -1 },
  descarte:         { tipo: 'descarte',          signo: -1 },
};

/**
 * Lee y limpia las tres hojas. No toca la BD.
 * @param {{productos: string, stock: string, movimientos: string}} csv
 * @param {{ambulancias: Array<{id, alias, matricula}>, usuarios: Array<{id, email}>}} contexto
 * @returns {{productos, lotes, movimientos, rechazos: Array<{hoja, fila, motivo}>, avisos: object}}
 */
function preparar(csv, { ambulancias = [], usuarios = [] } = {}) {
  const rechazos = [];
  const rechazar = (hoja, fila, motivo) => rechazos.push({ hoja, fila, motivo });
  const avisos = { sinAmbulancia: {}, sinUsuario: {}, nombresRepetidos: [] };

  const productos = [];
  const codigosProducto = new Set();
  const nombres = new Map();
  for (const f of tabla(csv.productos)) {
    const codigo = col(f, 'IDProducto');
    const nombre = col(f, 'Nombre').replace(/\s+/g, ' ');
    if (!codigo) { rechazar('Productos', f._fila, 'sin IDProducto'); continue; }
    if (!nombre) { rechazar('Productos', f._fila, `${codigo} sin nombre`); continue; }
    if (codigosProducto.has(codigo)) { rechazar('Productos', f._fila, `${codigo} repetido`); continue; }
    const minimo = col(f, 'Stock Mínimo', 'Stock Minimo');
    const tipo = /^medicaci/i.test(col(f, 'Tipo')) ? 'medicacion' : 'producto';
    const clave = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (nombres.has(clave)) avisos.nombresRepetidos.push(nombre);
    nombres.set(clave, codigo);
    codigosProducto.add(codigo);
    productos.push({
      codigo,
      nombre: nombre.slice(0, 150),
      presentacion: (col(f, 'Presentación', 'Presentacion') || 'Unidad').slice(0, 30),
      tipo,
      stock_minimo: /^\d+$/.test(minimo) ? Number(minimo) : 0,
    });
  }

  const lotes = [];
  const codigosLote = new Set();
  for (const f of tabla(csv.stock)) {
    const codigo = col(f, 'IDStock');
    const producto = col(f, 'Producto');
    if (!codigo) { rechazar('Stock', f._fila, 'sin IDStock'); continue; }
    if (codigosLote.has(codigo)) { rechazar('Stock', f._fila, `${codigo} repetido`); continue; }
    if (!codigosProducto.has(producto)) { rechazar('Stock', f._fila, `${codigo}: el producto ${producto || '(vacío)'} no existe`); continue; }
    const caducidad = caducidadDeHoja(col(f, 'Caducidad'));
    if (caducidad === undefined) { rechazar('Stock', f._fila, `${codigo}: caducidad «${col(f, 'Caducidad')}» no se entiende`); continue; }
    codigosLote.add(codigo);
    lotes.push({ codigo, producto, caducidad });
  }

  // Movimientos cuyo lote se borró de Stock: si su clave es de la forma vieja
  // `producto-MM/DD/YYYY` (o `producto-`, sin caducidad) y el producto existe,
  // el lote se rehace desde la clave para no perder esos movimientos.
  avisos.lotesReconstruidos = [];
  for (const f of tabla(csv.movimientos)) {
    const lote = col(f, 'Lote');
    if (!lote || codigosLote.has(lote)) continue;
    const m = /^([^-\s]+)-(?:(\d{2})\/(\d{2})\/(\d{4}))?$/.exec(lote);
    if (!m || !codigosProducto.has(m[1])) continue;
    const caducidad = m[2] ? caducidadDeHoja(`${m[3]}/${m[2]}/${m[4]}`) : null;
    if (caducidad === undefined) continue;
    codigosLote.add(lote);
    lotes.push({ codigo: lote, producto: m[1], caducidad });
    avisos.lotesReconstruidos.push(lote);
  }

  // Activas primero; las borradas solo si ninguna activa casa (en PRO la SVB-01
  // ya está dada de baja y sus salidas siguen siendo suyas). Al borrar, la
  // matrícula y el email se renombran con «__del_N»: se quita para casar.
  const sinBorrado = v => String(v ?? '').replace(/__del_\d+$/, '');
  const activosPrimero = lista => [...lista].sort((a, b) => Number(!!a.borrado) - Number(!!b.borrado));
  const porClave = new Map();
  for (const a of activosPrimero(ambulancias)) {
    for (const v of [a.alias, sinBorrado(a.matricula)]) {
      const k = claveAmbulancia(v);
      if (k && !porClave.has(k)) porClave.set(k, a.id);
    }
  }
  const porEmail = new Map();
  for (const u of activosPrimero(usuarios)) {
    const k = claveEmail(sinBorrado(u.email));
    if (k && !porEmail.has(k)) porEmail.set(k, u.id);
  }

  const movimientos = [];
  const codigosMov = new Set();
  for (const f of tabla(csv.movimientos)) {
    const codigo = col(f, 'Movimiento');
    if (!codigo) { rechazar('Movimientos', f._fila, 'sin id de movimiento'); continue; }
    if (codigosMov.has(codigo)) { rechazar('Movimientos', f._fila, `${codigo} repetido`); continue; }
    const t = TIPOS[col(f, 'Tipo').toLowerCase()];
    if (!t) { rechazar('Movimientos', f._fila, `${codigo}: tipo «${col(f, 'Tipo')}» desconocido`); continue; }
    const lote = col(f, 'Lote');
    if (!lote) { rechazar('Movimientos', f._fila, `${codigo}: sin lote`); continue; }
    if (!codigosLote.has(lote)) { rechazar('Movimientos', f._fila, `${codigo}: el lote ${lote} no está en Stock`); continue; }
    const cantidadTxt = col(f, 'Cantidad').replace(',', '.');
    const cantidad = Number(cantidadTxt);
    if (!cantidadTxt || !Number.isInteger(cantidad) || cantidad <= 0) {
      rechazar('Movimientos', f._fila, `${codigo}: cantidad «${col(f, 'Cantidad')}» no válida`); continue;
    }
    const fecha = instanteDeHoja(col(f, 'Fecha'));
    if (!fecha) { rechazar('Movimientos', f._fila, `${codigo}: fecha «${col(f, 'Fecha')}» no se entiende`); continue; }

    let vehicleId = null;
    let destino = null;
    if (t.tipo === 'salida_ambulancia') {
      destino = col(f, 'Destino') || null;
      vehicleId = porClave.get(claveAmbulancia(destino)) ?? null;
      if (!vehicleId) {
        const k = destino || '(vacío)';
        avisos.sinAmbulancia[k] = (avisos.sinAmbulancia[k] || 0) + 1;
      } else destino = null;
    } else if (t.tipo === 'salida_otros') {
      // En la hoja hay «…» y vacíos: se guarda igual, pero dicho.
      const otros = col(f, 'Otros').replace(/\s+/g, ' ');
      destino = otros && !/^[.…\s]+$/.test(otros) ? otros : 'Sin especificar';
    }
    const email = col(f, 'Usuario').toLowerCase();
    const userId = porEmail.get(claveEmail(email)) ?? null;
    if (email && !userId) avisos.sinUsuario[email] = (avisos.sinUsuario[email] || 0) + 1;

    codigosMov.add(codigo);
    movimientos.push({
      codigo,
      lote,
      tipo: t.tipo,
      cantidad: t.signo * cantidad,
      vehicle_id: vehicleId,
      destino: destino ? destino.slice(0, 150) : null,
      user_id: userId,
      usuario_origen: userId ? null : (email.slice(0, 150) || null),
      fecha,
    });
  }

  return { productos, lotes, movimientos, rechazos, avisos };
}

/**
 * Escribe lo preparado con la conexión de una transacción (`conn.query`). El
 * script decide si hace commit (--aplicar) o rollback (ensayo).
 * @returns {Promise<{productos: number, lotes: number, movimientos: number, borrados: number, negativos: Array}>}
 */
async function escribir(conn, { productos, lotes, movimientos }, ahora = new Date()) {
  const idProducto = new Map();
  for (const p of productos) {
    await conn.query(
      `INSERT INTO material_productos (nombre, presentacion, tipo, stock_minimo, codigo_origen, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), presentacion = VALUES(presentacion),
         tipo = VALUES(tipo), stock_minimo = VALUES(stock_minimo), updated_at = VALUES(updated_at)`,
      [p.nombre, p.presentacion, p.tipo, p.stock_minimo, p.codigo, ahora, ahora]
    );
  }
  const [filasP] = await conn.query('SELECT id, codigo_origen FROM material_productos WHERE codigo_origen IS NOT NULL');
  for (const f of filasP) idProducto.set(f.codigo_origen, f.id);

  for (const l of lotes) {
    await conn.query(
      `INSERT INTO material_lotes (producto_id, caducidad, codigo_origen, created_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE producto_id = VALUES(producto_id), caducidad = VALUES(caducidad)`,
      [idProducto.get(l.producto), l.caducidad, l.codigo, ahora]
    );
  }
  const idLote = new Map();
  const [filasL] = await conn.query('SELECT id, codigo_origen FROM material_lotes WHERE codigo_origen IS NOT NULL');
  for (const f of filasL) idLote.set(f.codigo_origen, f.id);

  for (const m of movimientos) {
    await conn.query(
      `INSERT INTO material_movimientos
         (lote_id, tipo, cantidad, vehicle_id, destino, user_id, usuario_origen, fecha, codigo_origen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE lote_id = VALUES(lote_id), tipo = VALUES(tipo), cantidad = VALUES(cantidad),
         vehicle_id = VALUES(vehicle_id), destino = VALUES(destino), user_id = VALUES(user_id),
         usuario_origen = VALUES(usuario_origen), fecha = VALUES(fecha)`,
      [idLote.get(m.lote), m.tipo, m.cantidad, m.vehicle_id, m.destino, m.user_id, m.usuario_origen,
       m.fecha, m.codigo, ahora]
    );
  }

  // Lo importado que ya no está en la hoja (borrado en el AppSheet). Lo
  // apuntado en la app (codigo_origen NULL) no se toca nunca.
  let borrados = 0;
  const codigos = movimientos.map(m => m.codigo);
  const [importados] = await conn.query('SELECT id, codigo_origen FROM material_movimientos WHERE codigo_origen IS NOT NULL');
  const sobran = importados.filter(f => !codigos.includes(f.codigo_origen)).map(f => f.id);
  if (sobran.length) {
    const [r] = await conn.query('DELETE FROM material_movimientos WHERE id IN (?)', [sobran]);
    borrados = r.affectedRows;
  }

  const [negativos] = await conn.query(
    `SELECT p.nombre, DATE_FORMAT(l.caducidad, '%Y-%m-%d') AS caducidad, l.codigo_origen AS lote, SUM(m.cantidad) AS stock
       FROM material_lotes l
       JOIN material_productos p ON p.id = l.producto_id
       JOIN material_movimientos m ON m.lote_id = l.id
      GROUP BY l.id, p.nombre, l.caducidad, l.codigo_origen
     HAVING SUM(m.cantidad) < 0
      ORDER BY p.nombre`
  );

  return {
    productos: productos.length,
    lotes: lotes.length,
    movimientos: movimientos.length,
    borrados,
    negativos: negativos.map(n => ({ ...n, stock: Number(n.stock) })),
  };
}

module.exports = { parseCsv, tabla, caducidadDeHoja, instanteDeHoja, claveAmbulancia, claveEmail, preparar, escribir };
