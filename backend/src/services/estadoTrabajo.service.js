/**
 * services/estadoTrabajo.service.js
 * El estado de un trabajo se DERIVA de sus ambulancias; nadie lo escribe a mano
 * salvo el cierre del coordinador (`trabajos.controller.cerrarTrabajo`).
 *
 * Vive fuera de los controladores porque lo cambian sitios distintos: activar,
 * finalizar, cancelar o borrar una asignación (asignaciones.controller), dar de
 * alta un trabajo con su primera ambulancia (trabajos.controller) y el cron que
 * activa asignaciones a su hora (server.js). Si cada uno lo calculara a su
 * manera, el padre se desincronizaría (riesgo anotado en el plan del trabajo
 * padre): por eso hay UNA función y todos la llaman.
 *
 * Conviven dos modelos hasta la fase 6 (MAPA_CODIGO.md §6.2):
 *  - nuevo (v33): las ambulancias son asignaciones con `trabajo_id`;
 *  - antiguo (v25): filas de `trabajo_vehiculos`, cada una con su ciclo.
 * Un trabajo con asignaciones se rige por ellas; uno sin ninguna, por el
 * antiguo.
 */

'use strict';

const { query }           = require('../config/database');
const { TRABAJO_ESTADOS } = require('../config/constants');
const logger              = require('../utils/logger.utils');
const avisos              = require('./avisosAsignacion.service');

const CERRADOS = [TRABAJO_ESTADOS.FINALIZADO, TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO];

/**
 * Modelo antiguo (v25), a partir de los estados de `trabajo_vehiculos`:
 *  - todos cerrados → finalizado (o finalizado_anticipado si alguno lo fue);
 *  - alguno activo o ya cerrado → activo (el trabajo está en marcha);
 *  - ninguno empezado → programado.
 * Sin vehículos devuelve null: ese trabajo se gestiona a mano (0 vehículos).
 */
function estadoTrabajoDesde(estados) {
  if (!estados.length) return null;
  if (estados.every(e => CERRADOS.includes(e))) {
    return estados.includes(TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO)
      ? TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO
      : TRABAJO_ESTADOS.FINALIZADO;
  }
  if (estados.some(e => e !== TRABAJO_ESTADOS.PROGRAMADO)) return TRABAJO_ESTADOS.ACTIVO;
  return TRABAJO_ESTADOS.PROGRAMADO;
}

/**
 * Modelo nuevo (v33), a partir de los estados de sus asignaciones vivas (sin
 * las borradas). Las canceladas no cuentan: una ambulancia que no va no
 * retiene ni cierra nada.
 *  - todas finalizadas → pendiente_cierre (D3: el trabajo NO se cierra solo;
 *    lo cierra el coordinador);
 *  - alguna activa o finalizada → activo;
 *  - ninguna empezada → programado.
 * Sin ninguna viva, programado: desde el 2026-10-10 un trabajo puede quedarse
 * sin ambulancias (se crean después, o se quitan), y entonces no hay nada en
 * marcha.
 */
function estadoTrabajoDesdeAsignaciones(estados) {
  const vivas = estados.filter(e => e !== 'cancelada');
  if (!vivas.length) return TRABAJO_ESTADOS.PROGRAMADO;
  if (vivas.every(e => e === 'finalizada')) return TRABAJO_ESTADOS.PENDIENTE_CIERRE;
  if (vivas.some(e => e !== 'programada')) return TRABAJO_ESTADOS.ACTIVO;
  return TRABAJO_ESTADOS.PROGRAMADO;
}

/**
 * Recalcula `trabajos.estado`. Se guarda en vez de calcularse al leer para que
 * el listado y el calendario sigan filtrando por una columna.
 *
 * `conn` es la conexión de una TRANSACCIÓN: lo primero es bloquear la fila del
 * trabajo (`FOR UPDATE`), para que dos cambios cruzados en ambulancias del
 * mismo trabajo se sincronicen uno detrás de otro. Sin eso, con dos cierres a
 * la vez cada uno veía al otro aún `activa` (REPEATABLE READ), los dos
 * calculaban `activo` y el trabajo se quedaba sin pasar a pendiente de cierre
 * ni avisar (reproducido contra MySQL en la revisión del 2026-10-10). Trampa:
 * el bloqueo tiene que ser la PRIMERA lectura de la transacción; una lectura
 * sin bloqueo antes fijaría la foto de la que lee el SELECT de abajo. Hoy los
 * llamadores solo escriben antes de llamar.
 *
 * Un trabajo ya cerrado no se toca (`estado NOT IN` cerrados): el cierre es
 * un acto del coordinador y nada derivado lo deshace. Y el `estado <> ?` hace
 * que `cambia` diga si ESTA llamada movió el estado — con mysql2, que cuenta
 * filas encontradas y no cambiadas, es la única forma de saberlo, y es lo que
 * impide que dos cierres de ambulancia cruzados avisen dos veces al
 * coordinador.
 *
 * @returns {Promise<{estado: string|null, cambia: boolean}>}
 */
async function sincronizarEstadoTrabajo(conn, trabajoId) {
  await conn.execute('SELECT id FROM trabajos WHERE id = ? FOR UPDATE', [trabajoId]);
  // Todas, también las borradas: basta con que haya tenido UNA para saber que
  // es del modelo nuevo, aunque ya no le quede ninguna viva. Un trabajo que
  // nunca ha tenido ninguna (recién creado sin ambulancias, o uno v25) no se
  // toca desde aquí.
  const [asigs] = await conn.execute(
    'SELECT estado, deleted_at IS NOT NULL AS borrada FROM asignaciones_libres WHERE trabajo_id = ?',
    [trabajoId]
  );
  let estado;
  if (Array.isArray(asigs) && asigs.length) {
    estado = estadoTrabajoDesdeAsignaciones(asigs.filter(r => !Number(r.borrada)).map(r => r.estado));
  } else {
    const [rows] = await conn.execute(
      'SELECT estado FROM trabajo_vehiculos WHERE trabajo_id = ?', [trabajoId]
    );
    estado = estadoTrabajoDesde((Array.isArray(rows) ? rows : []).map(r => r.estado));
  }
  if (!estado) return { estado: null, cambia: false };

  const [res] = await conn.execute(
    `UPDATE trabajos SET estado = ?
      WHERE id = ? AND estado <> ? AND estado NOT IN ('finalizado', 'finalizado_anticipado')`,
    [estado, trabajoId, estado]
  );
  return { estado, cambia: (res?.affectedRows || 0) > 0 };
}

/**
 * Tras confirmar la transacción: si el trabajo acaba de quedar pendiente de
 * cierre, avisa al coordinador. Va fuera de la transacción a propósito: si se
 * deshiciera, el aviso habría anunciado algo que no pasó.
 *
 * Se llama sin await y nunca lanza (como todos los avisos).
 */
async function avisarSiPendienteCierre(trabajoId, resultado) {
  if (!trabajoId || !resultado?.cambia || resultado.estado !== TRABAJO_ESTADOS.PENDIENTE_CIERRE) return;
  try {
    const [rows] = await query(
      'SELECT id, identificador, nombre, coordinador_user_id FROM trabajos WHERE id = ?',
      [trabajoId]
    );
    if (rows.length) await avisos.avisarTrabajoPendienteCierre(rows[0]);
  } catch (err) {
    logger.error(`Aviso de trabajo pendiente de cierre no enviado: ${err?.message || err}`);
  }
}

module.exports = {
  CERRADOS,
  estadoTrabajoDesde,
  estadoTrabajoDesdeAsignaciones,
  sincronizarEstadoTrabajo,
  avisarSiPendienteCierre,
};
