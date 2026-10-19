/**
 * services/jornadas.service.js
 * El horario por días de un trabajo de varios días y las jornadas que ficha
 * cada ambulancia (v39, §6.1 «Jornadas por día» del mapa).
 *
 * - `trabajo_jornadas` es la PLANTILLA: el horario que define el
 *   administrador en el trabajo, uno o varios tramos por día.
 * - `asignacion_jornadas` es lo que se ficha: cada ambulancia tiene sus
 *   propias filas, copiadas del trabajo (las que caen dentro de sus fechas) o
 *   propias (`asignaciones_libres.horario_propio = 1`).
 *
 * Vive fuera de los controladores porque lo usan trabajos y asignaciones, y
 * en un controlador crearía una dependencia circular (como
 * coordinadores.service).
 *
 * Regla que manda en todo el fichero: **una jornada fichada no se borra**.
 * Su hora real es la evidencia del servicio. Cambiar el horario reescribe solo
 * las que nadie ha pulsado; a una fichada, como mucho, se le mueve la hora
 * prevista.
 */

'use strict';

const { query } = require('../config/database');
const { instanteUtc, diaYHoraEnEspana, fechaEnEspana } = require('../utils/fecha.utils');

/** Tope de tramos por horario: dos meses con un tramo al día, de sobra. */
const MAX_TRAMOS = 62;
/** Un tramo no dura más de un día: lo que pase de ahí es un error al teclear. */
const DURACION_MAX_MS = 24 * 60 * 60 * 1000;

const valido = (d) => d instanceof Date && !Number.isNaN(d.getTime());

/**
 * Normaliza el horario que llega en el body: `[{inicio, fin}]` en UTC sin
 * zona (lo que manda `toUtcIso`) o con zona.
 *  - `undefined` → no viene: no se toca nada.
 *  - `null` o `[]` → sin horario.
 * Ordenado por inicio, sin solapes, cada tramo de más de 0 y como mucho 24 h,
 * y dentro de `[fecha_inicio, fecha_fin]` si se pasan.
 *
 * @returns {{horario?: Array<{inicio: Date, fin: Date}>, error?: string}}
 */
function leerHorario(lista, { fecha_inicio, fecha_fin } = {}) {
  if (lista === undefined) return { horario: undefined };
  if (lista === null) return { horario: [] };
  if (!Array.isArray(lista)) return { error: 'El horario debe ser una lista de tramos' };
  if (lista.length > MAX_TRAMOS) return { error: `El horario admite como mucho ${MAX_TRAMOS} tramos` };

  const tramos = [];
  for (const t of lista) {
    const inicio = t && t.inicio ? instanteUtc(t.inicio) : null;
    const fin    = t && t.fin    ? instanteUtc(t.fin)    : null;
    if (!valido(inicio) || !valido(fin)) return { error: 'Cada tramo del horario necesita hora de inicio y de fin' };
    if (fin <= inicio) {
      return { error: `El tramo del ${diaYHoraEnEspana(inicio)} termina antes de empezar` };
    }
    if (fin - inicio > DURACION_MAX_MS) {
      return { error: `El tramo del ${diaYHoraEnEspana(inicio)} dura más de 24 horas` };
    }
    tramos.push({ inicio, fin });
  }
  tramos.sort((a, b) => a.inicio - b.inicio);

  for (let i = 1; i < tramos.length; i++) {
    if (tramos[i].inicio < tramos[i - 1].fin) {
      return { error: `Los tramos del ${diaYHoraEnEspana(tramos[i - 1].inicio)} y del ` +
        `${diaYHoraEnEspana(tramos[i].inicio)} se solapan` };
    }
  }

  const desde = fecha_inicio ? instanteUtc(fecha_inicio) : null;
  const hasta = fecha_fin    ? instanteUtc(fecha_fin)    : null;
  const fuera = tramos.find(t => (desde && t.inicio < desde) || (hasta && t.fin > hasta));
  if (fuera) {
    return { error: `El tramo del ${diaYHoraEnEspana(fuera.inicio)} cae fuera de las fechas de inicio y fin` };
  }
  return { horario: tramos };
}

/**
 * Los tramos del horario que tocan `[fechaInicio, fechaFin)`: lo que hereda
 * una ambulancia que no va todos los días del trabajo.
 */
function tramosDentro(horario, fechaInicio, fechaFin) {
  const desde = instanteUtc(fechaInicio);
  const hasta = instanteUtc(fechaFin);
  return (horario || []).filter(t => instanteUtc(t.inicio) < hasta && instanteUtc(t.fin) > desde);
}

/** El horario (plantilla) de un trabajo, ordenado. */
async function horarioDelTrabajo(trabajoId, ejecutar = query) {
  const [rows] = await ejecutar(
    'SELECT id, inicio, fin FROM trabajo_jornadas WHERE trabajo_id = ? ORDER BY inicio, id',
    [trabajoId]
  );
  return rows || [];
}

/** Reescribe el horario (plantilla) del trabajo. Dentro de la transacción de quien llama. */
async function guardarHorarioTrabajo(conn, trabajoId, horario) {
  await conn.execute('DELETE FROM trabajo_jornadas WHERE trabajo_id = ?', [trabajoId]);
  for (const t of horario) {
    await conn.execute(
      'INSERT INTO trabajo_jornadas (trabajo_id, inicio, fin) VALUES (?, ?, ?)',
      [trabajoId, t.inicio, t.fin]
    );
  }
}

/** Las jornadas de una ambulancia, con quién las fichó. */
async function jornadasDe(asignacionId, ejecutar = query) {
  const [rows] = await ejecutar(
    `SELECT j.id, j.inicio, j.fin, j.inicio_real_at, j.fin_real_at, j.motivo_fin, j.cierre_auto,
            j.inicio_por, j.fin_por,
            CONCAT(ui.nombre, ' ', ui.apellidos) AS inicio_por_nombre,
            CONCAT(uf.nombre, ' ', uf.apellidos) AS fin_por_nombre
       FROM asignacion_jornadas j
       LEFT JOIN users ui ON ui.id = j.inicio_por
       LEFT JOIN users uf ON uf.id = j.fin_por
      WHERE j.asignacion_id = ?
      ORDER BY j.inicio, j.id`,
    [asignacionId]
  );
  return (rows || []).map(j => ({ ...j, cierre_auto: !!Number(j.cierre_auto) }));
}

const solapan = (a, b) => instanteUtc(a.inicio) < instanteUtc(b.fin) && instanteUtc(a.fin) > instanteUtc(b.inicio);

const mismoInstante = (a, b) => instanteUtc(a).getTime() === instanteUtc(b).getTime();

/**
 * Deja las jornadas de una ambulancia como `horario`, sin perder lo fichado.
 * Compara con lo que hay en vez de borrar y recrear (revisión del 2026-10-17):
 * recrear cambiaba los ids —quien tuviera la ficha abierta pulsaba sobre una
 * jornada que ya no existía— y perdía `aviso_sin_iniciar_at`, así que el push
 * urgente volvía a sonar por una jornada ya avisada. Por eso:
 *  - un tramo igual a una jornada sin fichar la deja tal cual (id y candado);
 *  - uno que cae encima de una fichada no se duplica: se le pone a la fichada
 *    como hora prevista (lo fichado no se borra nunca);
 *  - uno con el mismo inicio que una sin fichar le cambia el fin y conserva
 *    el candado;
 *  - el resto se crea, y las sin fichar que ya no están en el horario se borran.
 * Dentro de la transacción de quien llama (bloquea las filas de la ambulancia).
 *
 * @returns {Promise<{conservadas: number}>} cuántas fichadas se han quedado
 */
async function aplicarJornadas(conn, asignacionId, horario) {
  const [actuales] = await conn.execute(
    'SELECT id, inicio, fin, inicio_real_at FROM asignacion_jornadas WHERE asignacion_id = ? FOR UPDATE',
    [asignacionId]
  );
  const filas = actuales || [];
  const fichadas = filas.filter(j => j.inicio_real_at);
  const libres = filas.filter(j => !j.inicio_real_at);
  const usadas = new Set();
  const libre = (cond) => libres.find(j => !usadas.has(j.id) && cond(j));

  for (const t of horario || []) {
    const igual = libre(j => mismoInstante(j.inicio, t.inicio) && mismoInstante(j.fin, t.fin));
    if (igual) { usadas.add(igual.id); continue; }

    // Antes que reutilizar una libre: si pisa una fichada, el tramo es esa
    // jornada. Al revés, una libre estirada encima de una fichada dejaba dos
    // jornadas solapadas (revisión del 2026-10-18)
    const encima = fichadas.find(f => !usadas.has(f.id) && solapan(f, t));
    if (encima) {
      usadas.add(encima.id);
      await conn.execute('UPDATE asignacion_jornadas SET inicio = ?, fin = ? WHERE id = ?',
        [t.inicio, t.fin, encima.id]);
      continue;
    }

    const mismoInicio = libre(j => mismoInstante(j.inicio, t.inicio));
    if (mismoInicio) {
      usadas.add(mismoInicio.id);
      await conn.execute('UPDATE asignacion_jornadas SET fin = ? WHERE id = ?', [t.fin, mismoInicio.id]);
      continue;
    }

    await conn.execute(
      'INSERT INTO asignacion_jornadas (asignacion_id, inicio, fin) VALUES (?, ?, ?)',
      [asignacionId, t.inicio, t.fin]
    );
  }

  // Las sin fichar que el horario nuevo ya no lleva. `inicio_real_at IS NULL`
  // otra vez en el WHERE: si se ficharon en el hueco, se quedan.
  const sobran = libres.filter(j => !usadas.has(j.id)).map(j => j.id);
  if (sobran.length) {
    await conn.execute(
      `DELETE FROM asignacion_jornadas
        WHERE id IN (${sobran.map(() => '?').join(',')}) AND inicio_real_at IS NULL`,
      sobran
    );
  }
  return { conservadas: fichadas.length };
}

/** El día español ('yyyy-MM-dd') en que empieza un tramo: el «día» del horario. */
const diaDe = (t) => fechaEnEspana(instanteUtc(t.inicio));

/**
 * Los días que tiene `despues` y no tenía `antes` (dos horarios de trabajo):
 * los días que se acaban de añadir al trabajo.
 */
function diasNuevos(antes, despues) {
  const habia = new Set((antes || []).map(diaDe));
  return [...new Set((despues || []).map(diaDe))].filter(d => !habia.has(d));
}

/**
 * Lleva el horario del trabajo a sus ambulancias abiertas (`programada` o
 * `activa`), cada una con los tramos que caen en sus fechas:
 *  - Las que lo siguen (`horario_propio = 0`) quedan con eso, sin más.
 *  - Las de horario propio no se tocan en los días que ya tienen, pero
 *    reciben los `nuevos` días del trabajo que caen en sus fechas y en los
 *    que no tienen ninguna jornada (2026-10-19, CONGRESO SEVILLA y
 *    CHINCHILLA ampliados un día: con horario propio, el día añadido al
 *    trabajo no llegaba a la ambulancia y no había forma clara de ponérselo).
 *    Personalizar es por día: un día que el administrador le quitó a mano no
 *    vuelve, porque solo cuentan los días que el trabajo no tenía. Y si se le
 *    acaba de mover el fin con el del trabajo (`recortar`), las sin fichar que
 *    se han quedado fuera de sus fechas se quitan; las fichadas, nunca. Sin
 *    eso no se le borra nada (revisión del 2026-10-19).
 * Dentro de la transacción de quien llama, con las ambulancias ya bloqueadas.
 *
 * @param {string[]} [opciones.nuevos]   días ('yyyy-MM-dd') recién añadidos al trabajo
 * @param {number[]} [opciones.recortar] ambulancias a las que se acaba de mover el fin
 * @param {number[]} [opciones.saltar]   ambulancias que no se tocan: las que no cabían en
 *   el fin nuevo al acortar el trabajo «se quedan como están», también su horario
 *   (prueba local del 2026-10-19: perdían las jornadas de los días quitados)
 */
async function propagarHorarioDelTrabajo(conn, trabajoId, horario, { nuevos = [], recortar = [], saltar = [] } = {}) {
  const [asigs] = await conn.execute(
    `SELECT id, fecha_inicio, fecha_fin, horario_propio FROM asignaciones_libres
      WHERE trabajo_id = ? AND deleted_at IS NULL
        AND estado IN ('programada', 'activa')`,
    [trabajoId]
  );
  for (const a of asigs || []) {
    if (saltar.includes(a.id)) continue;
    const suyos = tramosDentro(horario, a.fecha_inicio, a.fecha_fin);
    if (!Number(a.horario_propio)) {
      await aplicarJornadas(conn, a.id, suyos);
      continue;
    }
    if (!nuevos.length && !recortar.includes(a.id)) continue;
    const [tiene] = await conn.execute(
      'SELECT id, inicio, fin, inicio_real_at FROM asignacion_jornadas WHERE asignacion_id = ? FOR UPDATE', [a.id]);
    const actuales = tiene || [];
    const fuera = !recortar.includes(a.id) ? [] : actuales.filter(j => !j.inicio_real_at
      && tramosDentro([j], a.fecha_inicio, a.fecha_fin).length === 0).map(j => j.id);
    if (fuera.length) {
      await conn.execute(
        `DELETE FROM asignacion_jornadas
          WHERE id IN (${fuera.map(() => '?').join(',')}) AND inicio_real_at IS NULL`, fuera);
    }
    const quedan = actuales.filter(j => !fuera.includes(j.id));
    const diasSuyos = new Set(quedan.map(diaDe));
    const anadir = suyos.filter(t => nuevos.includes(diaDe(t)) && !diasSuyos.has(diaDe(t))
      && !quedan.some(j => solapan(j, t)));
    for (const t of anadir) {
      await conn.execute(
        'INSERT INTO asignacion_jornadas (asignacion_id, inicio, fin) VALUES (?, ?, ?)',
        [a.id, t.inicio, t.fin]
      );
    }
  }
}

/**
 * Las jornadas de una ambulancia que sigue al trabajo, recalculadas desde el
 * horario guardado del trabajo (al crearla o al cambiarle las fechas).
 */
async function heredarDelTrabajo(conn, asignacionId, trabajoId, fechaInicio, fechaFin) {
  const horario = await horarioDelTrabajo(trabajoId, (sql, p) => conn.execute(sql, p));
  await aplicarJornadas(conn, asignacionId, tramosDentro(horario, fechaInicio, fechaFin));
}

/** Para la auditoría: el horario como texto corto y comparable. */
function resumenHorario(horario) {
  return (horario || []).map(t => `${diaYHoraEnEspana(instanteUtc(t.inicio))}–${diaYHoraEnEspana(instanteUtc(t.fin))}`);
}

module.exports = {
  MAX_TRAMOS,
  leerHorario,
  tramosDentro,
  horarioDelTrabajo,
  guardarHorarioTrabajo,
  jornadasDe,
  aplicarJornadas,
  diasNuevos,
  propagarHorarioDelTrabajo,
  heredarDelTrabajo,
  resumenHorario,
};
