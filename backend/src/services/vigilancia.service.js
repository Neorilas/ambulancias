/**
 * services/vigilancia.service.js
 * Avisos que no los dispara nadie: los saca el cron al mirar el reloj.
 *
 * El resto de avisos de una asignación cuentan algo que alguien acaba de
 * hacer (activar, subir la última foto, cerrar el servicio) y salen de la
 * petición que lo hizo. Aquí es al revés: lo que hay que contar es que algo NO
 * ha pasado, y eso no tiene petición que lo dispare. Por eso vive fuera de los
 * controladores y lo llama `autoActivar` en server.js, en el mismo tick de un
 * minuto.
 *
 * Como el resto del módulo de avisos, nada de lo que hay aquí puede tumbar el
 * proceso: el cron corre sin dueño que capture un rechazo.
 */

'use strict';

const { query }  = require('../config/database');
const logger     = require('../utils/logger.utils');
const { ahora }  = require('../utils/fecha.utils');
const avisos     = require('./avisosAsignacion.service');
const { IMAGEN_TIPOS_INICIO, AVISO_FOTOS_INICIO_MINUTOS } = require('../config/constants');

/** Fotos de inicio distintas que hay subidas para una asignación. */
const SUBQ_FOTOS_INICIO = `
  (SELECT COUNT(DISTINCT vi.tipo_imagen)
     FROM vehicle_images vi
    WHERE vi.asignacion_id = al.id AND vi.momento = 'inicio')`;

/**
 * Asignaciones en servicio que llevan más de los minutos de gracia sin tener
 * completa la tanda de fotos de inicio. Avisa a los administradores UNA vez.
 *
 * Qué instante cuenta como «ha iniciado el servicio»: `inicio_real_at` si el
 * responsable pulsó el botón, y si no la `fecha_inicio` programada, que es
 * cuando la activó el cron. El segundo caso es justo el que más interesa
 * vigilar — es el de la asignación que arrancó sola y a la que nadie ha
 * entrado.
 *
 * Por qué el aviso se reclama con un UPDATE condicional y no basta con haber
 * filtrado en el SELECT: el cron vuelve a pasar cada minuto, así que sin una
 * marca persistente los teléfonos sonarían sesenta veces por hora. La columna
 * `aviso_fotos_pendientes_at` (v18) es ese candado, y las dos condiciones que
 * importan —que siga sin avisarse y que la tanda siga incompleta— van DENTRO
 * del UPDATE: si en el hueco entre el SELECT y el UPDATE el técnico completa
 * las fotos, la fila no se reclama y no se avisa de una tanda ya completa.
 *
 * Nunca lanza: devuelve un resumen, igual que `push.notificarAdmins`.
 */
async function revisarFotosInicioPendientes() {
  const minutos = AVISO_FOTOS_INICIO_MINUTOS;
  const total   = IMAGEN_TIPOS_INICIO.length;
  const resumen = { candidatas: 0, avisadas: 0 };

  try {
    // El instante lo pone Node, nunca MySQL (contrato de fechas del proyecto).
    const limite = new Date(ahora().getTime() - minutos * 60 * 1000);

    const [candidatas] = await query(
      `SELECT al.id, al.user_id,
              v.alias AS vehiculo_alias, v.matricula,
              CONCAT(u.nombre,' ',u.apellidos) AS responsable_nombre,
              ${SUBQ_FOTOS_INICIO} AS fotos_inicio
         FROM asignaciones_libres al
         JOIN vehicles v ON v.id = al.vehicle_id
         JOIN users u    ON u.id = al.user_id
        WHERE al.estado = 'activa'
          AND al.deleted_at IS NULL
          AND al.aviso_fotos_pendientes_at IS NULL
          AND COALESCE(al.inicio_real_at, al.fecha_inicio) <= ?
          AND ${SUBQ_FOTOS_INICIO} < ?`,
      [limite, total]
    );
    resumen.candidatas = candidatas.length;

    for (const asignacion of candidatas) {
      const [res] = await query(
        `UPDATE asignaciones_libres al
            SET al.aviso_fotos_pendientes_at = ?
          WHERE al.id = ?
            AND al.estado = 'activa'
            AND al.aviso_fotos_pendientes_at IS NULL
            AND ${SUBQ_FOTOS_INICIO} < ?`,
        [ahora(), asignacion.id, total]
      );
      if (res.affectedRows === 0) continue;   // ya avisado, cerrado o completado

      resumen.avisadas++;
      avisos.avisarFotosInicioPendientes(asignacion, {
        minutos,
        faltan: total - Number(asignacion.fotos_inicio || 0),
      });
    }

    if (resumen.avisadas > 0) {
      logger.info(
        `Avisadas ${resumen.avisadas} asignación(es) con fotos de inicio pendientes ` +
        `tras ${minutos} min`
      );
    }
  } catch (err) {
    logger.error(`Error vigilando fotos de inicio pendientes: ${err.message}`);
  }

  return resumen;
}

module.exports = { revisarFotosInicioPendientes };
