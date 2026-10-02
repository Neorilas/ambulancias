'use strict';

/**
 * Retención de asignaciones: borra del servidor las asignaciones cerradas hace
 * más de RETENCION_ASIGNACIONES_MESES, con sus miembros y sus fotos (fila y
 * fichero). El motivo es el espacio en disco, no la protección de datos: lo
 * borrado sigue archivado en Google Drive (cifrado), porque el backup sube las
 * fotos sin borrar nada en el remoto y guarda los dumps diarios (docs/BACKUPS.md §8).
 *
 * Qué se purga:
 *   - asignaciones finalizadas o canceladas cuyo cierre es anterior al corte.
 *     El cierre es `finalizado_at`; una cancelada no lo tiene y se usa
 *     `updated_at`, que en una cerrada ya no se mueve (los controladores no
 *     dejan editar una asignación cerrada). Si algo la toca, solo se retrasa.
 *   - asignaciones con borrado lógico cuyo `deleted_at` es anterior al corte.
 * Qué NO:
 *   - una programada o activa, sea de cuando sea;
 *   - usuarios, vehículos e incidencias. Las incidencias son del vehículo (una
 *     abierta no puede desaparecer): la FK es SET NULL y solo pierden el enlace.
 *
 * El total de la ficha del vehículo no baja: cada asignación purgada que
 * contaba (sin borrado lógico) suma 1 a `vehicles.asignaciones_purgadas` (v27).
 *
 * Antes de borrar nada se archiva en `informe_mensual` el informe de cada mes
 * que se va a tocar (services/informes.service.js): después, el cálculo en vivo
 * de ese mes ya no saldría. Si no se puede archivar, esta pasada no purga.
 *
 * Trampa: borrar la fila de la asignación NO borra sus fotos. La FK de
 * `vehicle_images.asignacion_id` es SET NULL, así que quedarían huérfanas en
 * la BD y en disco. Por eso aquí se borran antes, a mano.
 */

const { query, transaction } = require('../config/database');
const { RETENCION_ASIGNACIONES_MESES } = require('../config/constants');
const { ahora } = require('../utils/fecha.utils');
const { deleteFile } = require('../middleware/upload.middleware');
const logger = require('../utils/logger.utils');
const informes = require('./informes.service');

// Por tanda y por pasada: la primera vez que se enciende puede haber meses de
// atraso, y no conviene tener la BD ocupada de una sola vez. Lo que no quepa
// sale en la pasada siguiente (el cron la lanza cada pocas horas).
const TANDA = 100;
const MAX_POR_PASADA = 1000;

// Qué se purga (dos parámetros: el corte, dos veces). Lo usan la búsqueda de
// candidatas y el archivado de informes, que tienen que ver las mismas filas.
const CONDICION_PURGA = `(deleted_at IS NULL
                 AND estado IN ('finalizada', 'cancelada')
                 AND COALESCE(finalizado_at, updated_at) < ?)
             OR (deleted_at IS NOT NULL AND deleted_at < ?)`;

/** Instante de corte: `meses` meses antes de `instante`, en UTC. */
function corteRetencion(meses, instante = ahora()) {
  const corte = new Date(instante.getTime());
  corte.setUTCMonth(corte.getUTCMonth() - meses);
  return corte;
}

/**
 * Borra una asignación y todo lo suyo en una transacción. Devuelve las URLs de
 * sus fotos (o null si la fila ya no estaba), para borrar los ficheros
 * DESPUÉS del commit: si la transacción fallara, las filas seguirían apuntando a ficheros que ya no existen.
 */
async function purgarUna(asig) {
  return transaction(async (conn) => {
    const [fotos] = await conn.execute(
      'SELECT image_url FROM vehicle_images WHERE asignacion_id = ?',
      [asig.id]
    );
    await conn.execute('DELETE FROM vehicle_images WHERE asignacion_id = ?', [asig.id]);
    // asignacion_usuarios va en CASCADE; vehicle_incidencias en SET NULL.
    const [res] = await conn.execute('DELETE FROM asignaciones_libres WHERE id = ?', [asig.id]);
    if (res.affectedRows > 0 && asig.contaba) {
      await conn.execute(
        'UPDATE vehicles SET asignaciones_purgadas = asignaciones_purgadas + 1 WHERE id = ?',
        [asig.vehicle_id]
      );
    }
    // null = no había nada que borrar (otra pasada se adelantó): no cuenta.
    return res.affectedRows > 0 ? fotos.map(f => f.image_url) : null;
  });
}

/**
 * Una pasada de retención. No lanza nunca: la llama el cron y un fallo aquí
 * no puede tumbar la API. Devuelve lo que ha hecho, para el log y los tests.
 *
 * @param {object} [opts]
 * @param {number} [opts.meses]    - por defecto RETENCION_ASIGNACIONES_MESES
 * @param {Date}   [opts.instante] - "ahora"; los tests lo fijan
 */
async function purgarAsignacionesAntiguas({ meses = RETENCION_ASIGNACIONES_MESES, instante } = {}) {
  const resultado = { activa: meses > 0, asignaciones: 0, fotos: 0, fallidas: 0, ids: [] };
  if (!resultado.activa) return resultado;

  const corte = corteRetencion(meses, instante || ahora());

  // Primero el informe de cada mes que se va a tocar. Todas las candidatas,
  // no solo la primera tanda: basta que se purgue UNA asignación de un mes
  // para que su cálculo en vivo deje de ser verdad. Agrupadas por hora, que
  // es lo más fino que necesita saber a qué mes español pertenecen.
  try {
    const [inicios] = await query(
      `SELECT MIN(fecha_inicio) AS fecha_inicio
         FROM asignaciones_libres
        WHERE ${CONDICION_PURGA}
        GROUP BY DATE_FORMAT(fecha_inicio, '%Y%m%d%H')`,
      [corte, corte]
    );
    if (inicios.length) {
      resultado.informes_archivados =
        await informes.archivarMeses(inicios.map(r => r.fecha_inicio), instante || ahora());
    }
  } catch (err) {
    logger.error(`Retención: no se pudo archivar el informe mensual; no se purga nada: ${err.message}`);
    resultado.bloqueada = true;
    return resultado;
  }

  try {
    while (resultado.asignaciones + resultado.fallidas < MAX_POR_PASADA) {
      const [candidatas] = await query(
        `SELECT id, vehicle_id, (deleted_at IS NULL) AS contaba
           FROM asignaciones_libres
          WHERE ${CONDICION_PURGA}
          ORDER BY id
          LIMIT ${TANDA}
         OFFSET ${resultado.fallidas}`,
        [corte, corte]
      );
      if (!candidatas.length) break;

      for (const asig of candidatas) {
        try {
          const urls = await purgarUna({ ...asig, contaba: Boolean(asig.contaba) });
          if (urls === null) continue;
          for (const url of urls) deleteFile(url);
          resultado.asignaciones++;
          resultado.fotos += urls.length;
          resultado.ids.push(asig.id);
        } catch (err) {
          // Una que falla no para las demás. El OFFSET la salta en la
          // siguiente tanda; en la próxima pasada se vuelve a intentar.
          resultado.fallidas++;
          logger.error(`Retención: no se pudo purgar la asignación ${asig.id}: ${err.message}`);
        }
      }
      if (candidatas.length < TANDA) break;
    }
  } catch (err) {
    logger.error(`Retención: error buscando asignaciones a purgar: ${err.message}`);
  }

  if (resultado.asignaciones > 0) {
    logger.info(
      `Retención: purgadas ${resultado.asignaciones} asignación(es) cerradas antes de ` +
      `${corte.toISOString()} y ${resultado.fotos} foto(s)`
    );
    // Rastro en la auditoría: quien busque una asignación que ya no está tiene
    // que poder ver que la borró la retención y no una persona.
    // Con su propio try: la purga ya está hecha y confirmada; un fallo aquí no
    // puede convertirla en «error en retención» en el log del cron.
    try {
      const { logAudit } = require('../controllers/admin.controller');
      await logAudit({
      userId: null,
      userInfo: 'sistema (retención)',
      action: 'purga_retencion',
      entityType: 'asignacion',
      details: {
        meses,
        corte: corte.toISOString(),
        asignaciones: resultado.asignaciones,
        fotos: resultado.fotos,
        ids: resultado.ids.slice(0, 500),
      },
      impersonadoPor: null,
      });
    } catch (err) {
      logger.warn(`Retención: purga hecha pero sin rastro en audit_logs: ${err.message}`);
    }
  }
  return resultado;
}

module.exports = { purgarAsignacionesAntiguas, corteRetencion, TANDA };
