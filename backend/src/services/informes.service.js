'use strict';

/**
 * Informe mensual para administración: puntualidad, incidencias, flota,
 * calidad del registro y desglose por técnico.
 *
 * DE DÓNDE SALE UN MES
 *   - En vivo, de las asignaciones (`calcularInforme`), mientras estén todas.
 *   - Archivado, de `informe_mensual` (v28), en cuanto la retención va a
 *     purgar alguna de ese mes: `archivarMeses` lo guarda ANTES y la purga no
 *     sigue si no ha podido (retencion.service). Si hay fila archivada, manda
 *     ella: el cálculo en vivo de un mes a medio purgar daría cifras falsas.
 *
 * CRITERIOS (los que no se deducen del código)
 *   - Un servicio es del mes de su `fecha_inicio` PREVISTA, en hora española.
 *     Las canceladas y las borradas no cuentan en nada.
 *   - Inicio tardío: `inicio_real_at` más de INICIO_TARDIO_MINUTOS después de
 *     la hora prevista. Coincide con el aviso de «sin iniciar» (30 min), pero
 *     no es lo mismo: el aviso sale también de las que nunca se inician.
 *   - Sin iniciar: nadie pulsó «Inicio de servicio» y ya pasó el margen. En el
 *     mes en curso solo cuentan las que ya deberían haber empezado.
 *   - La llegada (v26) existe desde el 2026-09-25: antes, «no consta».
 *   - El retraso de un técnico es el de los servicios en que va de
 *     RESPONSABLE; el personal no puede iniciar (MAPA_CODIGO §6.1).
 *
 * El JSON se guarda tal cual en `informe_mensual.datos`: si cambia su forma,
 * se sube VERSION_INFORME y el frontend tiene que tolerar la vieja (un campo
 * que falta se pinta como «—»).
 */

const { query } = require('../config/database');
const { INICIO_TARDIO_MINUTOS, FOTOS_INICIO_TARDE_MINUTOS } = require('../config/constants');
const { ahora, instanteEnEspana, anioMesEnEspana } = require('../utils/fecha.utils');
const logger = require('../utils/logger.utils');

const VERSION_INFORME = 1;
const MINUTO = 60000;
const RE_MES = /^(\d{4})-(0[1-9]|1[0-2])$/;

// ── Meses ────────────────────────────────────────────────────

/** 'YYYY-MM' del mes español que contiene `instante`. */
function mesDe(instante) {
  const { anio, mes } = anioMesEnEspana(instante);
  return `${anio}-${String(mes).padStart(2, '0')}`;
}

/** ¿'YYYY-MM' válido? */
function esMes(txt) {
  return typeof txt === 'string' && RE_MES.test(txt);
}

/** El mes `delta` meses antes (negativo) o después de `mes`. */
function mesDesplazado(mes, delta) {
  const [a, m] = mes.split('-').map(Number);
  const total = a * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Instantes UTC de principio y fin (exclusivo) del mes español. */
function limitesMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  const siguiente = mesDesplazado(mes, 1).split('-').map(Number);
  return {
    desde: instanteEnEspana(a, m, 1),
    hasta: instanteEnEspana(siguiente[0], siguiente[1], 1),
  };
}

// ── Estadística ──────────────────────────────────────────────

function mediana(valores) {
  if (!valores.length) return null;
  const v = [...valores].sort((x, y) => x - y);
  const mitad = Math.floor(v.length / 2);
  return v.length % 2 ? v[mitad] : Math.round((v[mitad - 1] + v[mitad]) / 2);
}

function media(valores) {
  if (!valores.length) return null;
  return Math.round(valores.reduce((s, x) => s + x, 0) / valores.length);
}

const minutosEntre = (a, b) => Math.round((b.getTime() - a.getTime()) / MINUTO);

const nombreDe = (r) => [r.nombre, r.apellidos].filter(Boolean).join(' ').trim() || `Usuario ${r.user_id}`;

// ── Cálculo ──────────────────────────────────────────────────

/**
 * Lo que dice un servicio, ya digerido: los mismos campos alimentan el
 * resumen, la fila del vehículo y la de cada técnico.
 */
function analizarServicio(a, limiteSinIniciar) {
  const inicio = a.inicio_real_at;
  const s = {
    iniciado:       Boolean(inicio),
    retraso_min:    inicio ? minutosEntre(a.fecha_inicio, inicio) : null,
    tardio:         false,
    sin_iniciar:    !inicio && a.fecha_inicio.getTime() + INICIO_TARDIO_MINUTOS * MINUTO <= limiteSinIniciar.getTime(),
    con_llegada:    Boolean(inicio && a.llegada_servicio_at),
    desplazamiento: inicio && a.llegada_servicio_at ? minutosEntre(inicio, a.llegada_servicio_at) : null,
    finalizado:     a.estado === 'finalizada' && Boolean(a.finalizado_at),
    cierre_tardio:  false,
    cierre_anticipado: false,
    minutos_servicio: null,
    km:             null,
    fotos_tarde:    Number(a.fotos_inicio_tarde) > 0,
  };
  s.tardio = s.retraso_min != null && s.retraso_min > INICIO_TARDIO_MINUTOS;
  if (s.finalizado) {
    const margen = minutosEntre(a.fecha_fin, a.finalizado_at);
    s.cierre_tardio     = margen > INICIO_TARDIO_MINUTOS;
    s.cierre_anticipado = margen < -INICIO_TARDIO_MINUTOS;
    if (inicio) s.minutos_servicio = Math.max(0, minutosEntre(inicio, a.finalizado_at));
    // km_inicio es opcional al crear la asignación y casi nunca se rellena
    // (hasta el 2026-09-27 el inicio de servicio no lo guardaba): sin él vale
    // la última lectura anterior del mismo vehículo (`km_previo`).
    const kmSalida = a.km_inicio ?? a.km_previo ?? null;
    if (kmSalida != null && a.km_fin != null && a.km_fin >= kmSalida) s.km = a.km_fin - kmSalida;
  }
  return s;
}

/** Acumulador común a resumen, vehículo y técnico. */
function nuevoAcumulado() {
  return { servicios: 0, iniciados: 0, inicios_tardios: 0, sin_iniciar: 0, con_llegada: 0,
           con_fotos_inicio_tarde: 0, finalizados: 0, cierres_tardios: 0, cierres_anticipados: 0,
           minutos_servicio: 0, km_recorridos: 0,
           _retrasos: [], _desplazamientos: [] };
}

function acumular(acc, s) {
  acc.servicios++;
  if (s.iniciado)          acc.iniciados++;
  if (s.tardio)          { acc.inicios_tardios++; acc._retrasos.push(s.retraso_min); }
  if (s.sin_iniciar)       acc.sin_iniciar++;
  if (s.con_llegada)     { acc.con_llegada++; acc._desplazamientos.push(s.desplazamiento); }
  if (s.fotos_tarde)       acc.con_fotos_inicio_tarde++;
  if (s.finalizado)        acc.finalizados++;
  if (s.cierre_tardio)     acc.cierres_tardios++;
  if (s.cierre_anticipado) acc.cierres_anticipados++;
  if (s.minutos_servicio != null) acc.minutos_servicio += s.minutos_servicio;
  if (s.km != null)        acc.km_recorridos += s.km;
}

/** Cierra un acumulado: medianas en lugar de las listas crudas. */
function cerrar(acc) {
  const { _retrasos, _desplazamientos, minutos_servicio, ...resto } = acc;
  return {
    ...resto,
    horas_servicio: Math.round(minutos_servicio / 6) / 10,
    retraso_mediana_min: mediana(_retrasos),
    retraso_medio_min: media(_retrasos),
    desplazamiento_mediana_min: mediana(_desplazamientos),
  };
}

/**
 * Calcula el informe de un mes con lo que hay ahora en la BD.
 * @param {string} mes       'YYYY-MM'
 * @param {Date}  [instante] "ahora"; los tests lo fijan
 */
async function calcularInforme(mes, instante = ahora()) {
  const { desde, hasta } = limitesMes(mes);
  const limiteSinIniciar = instante < hasta ? instante : hasta;
  const filtro = `al.deleted_at IS NULL AND al.estado <> 'cancelada'
                  AND al.fecha_inicio >= ? AND al.fecha_inicio < ?`;

  const [asignaciones] = await query(
    `SELECT al.id, al.vehicle_id, al.estado, al.fecha_inicio, al.fecha_fin,
            al.inicio_real_at, al.llegada_servicio_at, al.finalizado_at,
            al.km_inicio, al.km_fin,
            (SELECT MAX(p.km_fin) FROM asignaciones_libres p
              WHERE p.vehicle_id = al.vehicle_id AND p.id <> al.id AND p.km_fin IS NOT NULL
                AND p.finalizado_at <= COALESCE(al.inicio_real_at, al.fecha_inicio)) AS km_previo,
            v.alias, v.matricula,
            (SELECT COUNT(*) FROM vehicle_images ti
              WHERE ti.asignacion_id = al.id AND ti.momento = 'inicio'
                AND al.inicio_real_at IS NOT NULL
                AND ti.created_at > al.inicio_real_at + INTERVAL ? MINUTE) AS fotos_inicio_tarde
       FROM asignaciones_libres al
       JOIN vehicles v ON v.id = al.vehicle_id
      WHERE ${filtro}`,
    [FOTOS_INICIO_TARDE_MINUTOS, desde, hasta]
  );

  const [miembros] = await query(
    `SELECT au.asignacion_id, au.user_id, au.rol, u.nombre, u.apellidos
       FROM asignacion_usuarios au
       JOIN asignaciones_libres al ON al.id = au.asignacion_id
       JOIN users u ON u.id = au.user_id
      WHERE ${filtro}`,
    [desde, hasta]
  );

  const [flota] = await query(
    `SELECT id, alias, matricula FROM vehicles WHERE deleted_at IS NULL`
  );

  // Incidencias: nuevas del mes, resueltas en el mes y abiertas al cerrarlo.
  // Una «resuelto» sin fecha (anterior a que se guardara) no cuenta como abierta.
  const [incidencias] = await query(
    `SELECT id, vehicle_id, gravedad, estado, created_at, resuelto_at, responsable_user_id
       FROM vehicle_incidencias
      WHERE (created_at >= ? AND created_at < ?)
         OR (resuelto_at >= ? AND resuelto_at < ?)
         OR (created_at < ? AND estado <> 'resuelto')
         OR (created_at < ? AND resuelto_at >= ?)`,
    [desde, hasta, desde, hasta, hasta, hasta, hasta]
  );

  // ── Servicios ──
  const resumen = nuevoAcumulado();
  const porVehiculo = new Map();
  const analisis = new Map();
  for (const a of asignaciones) {
    const s = analizarServicio(a, limiteSinIniciar);
    analisis.set(a.id, s);
    acumular(resumen, s);
    if (!porVehiculo.has(a.vehicle_id)) {
      porVehiculo.set(a.vehicle_id, { vehicle_id: a.vehicle_id, alias: a.alias, matricula: a.matricula,
                                      acc: nuevoAcumulado(), incidencias: 0 });
    }
    acumular(porVehiculo.get(a.vehicle_id).acc, s);
  }

  // ── Técnicos ──
  const porTecnico = new Map();
  const fichaTecnico = (r) => {
    if (!porTecnico.has(r.user_id)) {
      porTecnico.set(r.user_id, { user_id: r.user_id, nombre: nombreDe(r),
                                  acc: nuevoAcumulado(), como_personal: 0, incidencias: 0 });
    }
    return porTecnico.get(r.user_id);
  };
  for (const m of miembros) {
    const s = analisis.get(m.asignacion_id);
    if (!s) continue;
    const t = fichaTecnico(m);
    if (m.rol === 'responsable') acumular(t.acc, s);
    else t.como_personal++;
  }

  // ── Incidencias ──
  const inc = { nuevas: 0, graves: 0, moderadas: 0, leves: 0, resueltas: 0, abiertas_fin: 0,
                resolucion_mediana_horas: null };
  const resolucionesMin = [];
  for (const i of incidencias) {
    const creada = i.created_at;
    const nueva = creada >= desde && creada < hasta;
    if (nueva) {
      inc.nuevas++;
      if (i.gravedad === 'grave') inc.graves++;
      else if (i.gravedad === 'moderado') inc.moderadas++;
      else inc.leves++;
      const v = porVehiculo.get(i.vehicle_id);
      if (v) v.incidencias++;
      else {
        const fv = flota.find(f => f.id === i.vehicle_id);
        if (fv) porVehiculo.set(i.vehicle_id, { vehicle_id: fv.id, alias: fv.alias, matricula: fv.matricula,
                                                acc: nuevoAcumulado(), incidencias: 1 });
      }
      if (i.responsable_user_id && porTecnico.has(i.responsable_user_id)) {
        porTecnico.get(i.responsable_user_id).incidencias++;
      }
    }
    const resuelta = i.resuelto_at;
    if (resuelta && resuelta >= desde && resuelta < hasta) {
      inc.resueltas++;
      resolucionesMin.push(minutosEntre(creada, resuelta));
    }
    const abiertaAlFinal = creada < hasta &&
      (resuelta ? resuelta >= hasta : i.estado !== 'resuelto');
    if (abiertaAlFinal) inc.abiertas_fin++;
  }
  const minutosResolucion = mediana(resolucionesMin);
  inc.resolucion_mediana_horas = minutosResolucion == null ? null : Math.round(minutosResolucion / 6) / 10;

  const usados = new Set(asignaciones.map(a => a.vehicle_id));
  const vehiculosSinUso = flota
    .filter(f => !usados.has(f.id))
    .map(f => ({ vehicle_id: f.id, alias: f.alias, matricula: f.matricula }))
    .sort((x, y) => String(x.alias).localeCompare(String(y.alias), 'es'));

  const filaVehiculo = ({ acc, ...v }) => ({ ...v, ...cerrar(acc) });
  const filaTecnico  = ({ acc, ...t }) => ({ ...t, ...cerrar(acc) });

  return {
    version: VERSION_INFORME,
    mes,
    desde: desde.toISOString(),
    hasta: hasta.toISOString(),
    umbral_min: INICIO_TARDIO_MINUTOS,
    resumen: { ...cerrar(resumen), incidencias: inc, vehiculos_en_flota: flota.length,
               vehiculos_usados: usados.size },
    por_vehiculo: [...porVehiculo.values()].map(filaVehiculo)
      .sort((x, y) => y.servicios - x.servicios || String(x.alias).localeCompare(String(y.alias), 'es')),
    vehiculos_sin_uso: vehiculosSinUso,
    por_tecnico: [...porTecnico.values()].map(filaTecnico)
      .sort((x, y) => y.servicios - x.servicios || x.nombre.localeCompare(y.nombre, 'es')),
  };
}

// ── Archivo ──────────────────────────────────────────────────

async function leerArchivado(mes) {
  const [rows] = await query('SELECT datos, generado_at FROM informe_mensual WHERE mes = ?', [mes]);
  if (!rows.length) return null;
  const datos = typeof rows[0].datos === 'string' ? JSON.parse(rows[0].datos) : rows[0].datos;
  return { ...datos, fuente: 'archivado', generado_at: rows[0].generado_at };
}

/**
 * El informe de un mes: el archivado si lo hay, si no en vivo. Un mes futuro
 * da null. El mes en curso sale marcado `en_curso`.
 */
async function obtenerInforme(mes, instante = ahora()) {
  const actual = mesDe(instante);
  if (mes > actual) return null;
  const archivado = await leerArchivado(mes);
  if (archivado) return archivado;
  const vivo = await calcularInforme(mes, instante);
  return { ...vivo, fuente: 'en_vivo', en_curso: mes === actual };
}

/**
 * Guarda el informe de cada mes de la lista que aún no esté archivado. Solo
 * meses ya cerrados: el en curso todavía cambia. LANZA si no puede guardar
 * alguno, a propósito — quien llama (la retención) no debe purgar entonces.
 *
 * @param {Date[]} instantes fechas de inicio de las asignaciones a purgar
 * @returns {Promise<string[]>} meses archivados en esta llamada
 */
async function archivarMeses(instantes, instante = ahora()) {
  const actual = mesDe(instante);
  const meses = [...new Set(instantes.map(mesDe))].filter(m => m < actual).sort();
  if (!meses.length) return [];

  const [ya] = await query(
    `SELECT mes FROM informe_mensual WHERE mes IN (${meses.map(() => '?').join(',')})`,
    meses
  );
  const archivados = new Set(ya.map(r => r.mes));
  const nuevos = [];
  for (const mes of meses) {
    if (archivados.has(mes)) continue;
    const datos = await calcularInforme(mes, instante);
    // INSERT IGNORE: si otra pasada lo guardó en el hueco, vale el suyo.
    await query(
      'INSERT IGNORE INTO informe_mensual (mes, version, datos, generado_at) VALUES (?, ?, ?, ?)',
      [mes, VERSION_INFORME, JSON.stringify(datos), instante]
    );
    nuevos.push(mes);
  }
  if (nuevos.length) logger.info(`Informes: archivado el informe de ${nuevos.join(', ')} antes de purgar`);
  return nuevos;
}

module.exports = {
  calcularInforme, obtenerInforme, archivarMeses,
  mesDe, esMes, mesDesplazado, limitesMes, mediana,
  VERSION_INFORME,
};
