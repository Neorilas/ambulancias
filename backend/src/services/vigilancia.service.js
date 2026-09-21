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
const { AVISO_SIN_INICIAR_MINUTOS } = require('../config/constants');

/**
 * Asignaciones cuya hora prevista pasó hace más del margen y que siguen sin
 * iniciar. Avisa a los administradores UNA vez.
 *
 * Qué cuenta como iniciada: `inicio_real_at`, que lo sella el responsable al
 * pulsar «Inicio de servicio». El `estado` NO sirve para esto — el cron pone
 * en `activa` todo lo que llega a su hora, así que una asignación activa con
 * `inicio_real_at` a NULL es justo la que hay que vigilar: arrancó sola y
 * nadie ha entrado. Por eso el filtro mira `inicio_real_at` y usa el estado
 * solo para descartar lo que ya se cerró o se canceló.
 *
 * Por qué el aviso se reclama con un UPDATE condicional y no basta con haber
 * filtrado en el SELECT: el cron vuelve a pasar cada minuto, así que sin una
 * marca persistente los teléfonos sonarían sesenta veces por hora. La columna
 * `aviso_sin_iniciar_at` (v19) es ese candado, y las condiciones que importan
 * —que no se haya avisado ya y que siga sin iniciarse— van DENTRO del UPDATE:
 * si en el hueco entre el SELECT y el UPDATE el responsable pulsa el botón, la
 * fila no se reclama y no se avisa de algo que ya está en marcha. Por lo mismo
 * se repite ahí el `deleted_at IS NULL`: en ese hueco también cabe que alguien
 * borre la asignación, y avisar de algo que ya no existe confunde igual.
 *
 * Nunca lanza: devuelve un resumen, igual que `push.notificarAdmins`.
 */
async function revisarAsignacionesSinIniciar() {
  const minutos = AVISO_SIN_INICIAR_MINUTOS;
  const resumen = { candidatas: 0, avisadas: 0 };

  try {
    // El instante lo pone Node, nunca MySQL (contrato de fechas del proyecto).
    const limite = new Date(ahora().getTime() - minutos * 60 * 1000);

    const [candidatas] = await query(
      `SELECT al.id, al.user_id,
              v.alias AS vehiculo_alias, v.matricula,
              CONCAT(u.nombre,' ',u.apellidos) AS responsable_nombre,
              (SELECT GROUP_CONCAT(CONCAT(ru.nombre,' ',ru.apellidos) ORDER BY ra.orden SEPARATOR ', ')
                 FROM asignacion_usuarios ra JOIN users ru ON ra.user_id = ru.id
                WHERE ra.asignacion_id = al.id AND ra.rol = 'responsable') AS responsables_nombres
         FROM asignaciones_libres al
         JOIN vehicles v ON v.id = al.vehicle_id
         JOIN users u    ON u.id = al.user_id
        WHERE al.inicio_real_at IS NULL
          AND al.estado IN ('programada', 'activa')
          AND al.deleted_at IS NULL
          AND al.aviso_sin_iniciar_at IS NULL
          AND al.fecha_inicio <= ?`,
      [limite]
    );
    resumen.candidatas = candidatas.length;

    for (const asignacion of candidatas) {
      const [res] = await query(
        `UPDATE asignaciones_libres
            SET aviso_sin_iniciar_at = ?
          WHERE id = ?
            AND inicio_real_at IS NULL
            AND estado IN ('programada', 'activa')
            AND deleted_at IS NULL
            AND aviso_sin_iniciar_at IS NULL`,
        [ahora(), asignacion.id]
      );
      if (res.affectedRows === 0) continue;   // ya avisada, iniciada o cerrada

      resumen.avisadas++;
      avisos.avisarAsignacionSinIniciar(asignacion, { minutos });
    }

    if (resumen.avisadas > 0) {
      logger.info(
        `Avisadas ${resumen.avisadas} asignación(es) sin iniciar ${minutos} min ` +
        `después de su hora prevista`
      );
    }
  } catch (err) {
    logger.error(`Error vigilando asignaciones sin iniciar: ${err.message}`);
  }

  return resumen;
}

module.exports = { revisarAsignacionesSinIniciar };
