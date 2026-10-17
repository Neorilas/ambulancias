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
 * Lo mismo vale para el mantenimiento por km: los km los escriben cuatro
 * caminos distintos (ficha, cierre de asignación, dos del trabajo) y la
 * referencia se mueve a mano o con una revisión. Mirarlo desde el reloj cubre
 * todos sin tocar ninguno.
 *
 * Como el resto del módulo de avisos, nada de lo que hay aquí puede tumbar el
 * proceso: el cron corre sin dueño que capture un rechazo.
 */

'use strict';

const { query }  = require('../config/database');
const logger     = require('../utils/logger.utils');
const { ahora }  = require('../utils/fecha.utils');
const avisos     = require('./avisosAsignacion.service');
const push       = require('./push.service');
const { AVISO_SIN_INICIAR_MINUTOS, MANTENIMIENTO_PUSH_KM } = require('../config/constants');

/**
 * Asignaciones cuya hora prevista pasó hace más del margen y que siguen sin
 * iniciar. Avisa a los administradores UNA vez.
 *
 * Qué cuenta como iniciada: `inicio_real_at`, que lo sella el responsable al
 * pulsar «Inicio de la asignación». El `estado` NO sirve para esto — el cron pone
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
      `SELECT al.id, al.user_id, al.trabajo_id, t.nombre AS trabajo_nombre,
              v.alias AS vehiculo_alias, v.matricula,
              CONCAT(u.nombre,' ',u.apellidos) AS responsable_nombre,
              (SELECT GROUP_CONCAT(CONCAT(ru.nombre,' ',ru.apellidos) ORDER BY ra.orden SEPARATOR ', ')
                 FROM asignacion_usuarios ra JOIN users ru ON ra.user_id = ru.id
                WHERE ra.asignacion_id = al.id AND ra.rol = 'responsable') AS responsables_nombres
         FROM asignaciones_libres al
         JOIN vehicles v ON v.id = al.vehicle_id
         JOIN users u    ON u.id = al.user_id
         LEFT JOIN trabajos t ON t.id = al.trabajo_id
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

/**
 * Jornadas por día (v39): la jornada cuya hora prevista pasó hace más del
 * margen y nadie ha pulsado «Inicio de jornada». Mismo aviso urgente y misma
 * alarma que la asignación sin iniciar, con su propio candado
 * (`asignacion_jornadas.aviso_sin_iniciar_at`, dentro del UPDATE por lo mismo
 * que arriba).
 *
 * Solo con la asignación ya iniciada (`inicio_real_at`): si no, ya está
 * sonando la de la asignación y serían dos avisos por lo mismo. Y solo
 * mientras el tramo no ha terminado: después ya no se puede iniciar
 * (`iniciarJornada` lo rechaza) y la alarma no tendría arreglo; esa jornada
 * queda «no consta» y la marca el informe.
 *
 * Nunca lanza: devuelve un resumen.
 */
async function revisarJornadasSinIniciar() {
  const minutos = AVISO_SIN_INICIAR_MINUTOS;
  const resumen = { candidatas: 0, avisadas: 0 };

  try {
    const instante = ahora();
    const limite = new Date(instante.getTime() - minutos * 60 * 1000);

    const [candidatas] = await query(
      `SELECT j.id AS jornada_id, j.inicio AS jornada_inicio, j.fin AS jornada_fin,
              al.id, al.user_id, al.trabajo_id, t.nombre AS trabajo_nombre,
              v.alias AS vehiculo_alias, v.matricula,
              CONCAT(u.nombre,' ',u.apellidos) AS responsable_nombre,
              (SELECT GROUP_CONCAT(CONCAT(ru.nombre,' ',ru.apellidos) ORDER BY ra.orden SEPARATOR ', ')
                 FROM asignacion_usuarios ra JOIN users ru ON ra.user_id = ru.id
                WHERE ra.asignacion_id = al.id AND ra.rol = 'responsable') AS responsables_nombres
         FROM asignacion_jornadas j
         JOIN asignaciones_libres al ON al.id = j.asignacion_id
         JOIN vehicles v ON v.id = al.vehicle_id
         JOIN users u    ON u.id = al.user_id
         LEFT JOIN trabajos t ON t.id = al.trabajo_id
        WHERE j.inicio_real_at IS NULL
          AND j.aviso_sin_iniciar_at IS NULL
          AND j.inicio <= ?
          AND j.fin > ?
          AND al.estado = 'activa'
          AND al.inicio_real_at IS NOT NULL
          AND al.deleted_at IS NULL`,
      [limite, instante]
    );
    resumen.candidatas = candidatas.length;

    for (const fila of candidatas) {
      const [res] = await query(
        `UPDATE asignacion_jornadas
            SET aviso_sin_iniciar_at = ?
          WHERE id = ?
            AND inicio_real_at IS NULL
            AND aviso_sin_iniciar_at IS NULL`,
        [ahora(), fila.jornada_id]
      );
      if (res.affectedRows === 0) continue;   // ya avisada o ya iniciada

      resumen.avisadas++;
      const { jornada_id, jornada_inicio, jornada_fin, ...asig } = fila;
      avisos.avisarJornadaSinIniciar(asig, { id: jornada_id, inicio: jornada_inicio, fin: jornada_fin }, { minutos });
    }

    if (resumen.avisadas > 0) {
      logger.info(`Avisadas ${resumen.avisadas} jornada(s) sin iniciar ${minutos} min después de su hora prevista`);
    }
  } catch (err) {
    logger.error(`Error vigilando jornadas sin iniciar: ${err.message}`);
  }

  return resumen;
}

/**
 * Las asignaciones que hoy tienen la alarma sonando: las que ya se avisaron por
 * push como «sin iniciar» y siguen sin iniciarse. Es lo que pinta la alarma
 * sonora de la app (`AlarmaSinIniciar` en el frontend), que vuelve a preguntar
 * cada poco mientras un administrador tiene la app abierta.
 *
 * Se apoya en la MISMA marca que el push (`aviso_sin_iniciar_at`) para que los
 * dos canales digan lo mismo: suena en la app lo que ya se avisó al teléfono,
 * ni antes ni otra cosa. Deja de salir sola en cuanto el responsable pulsa
 * «Inicio de la asignación» o la asignación se cierra, se cancela o se borra.
 *
 * El `fecha_inicio <= límite` se repite a propósito: si alguien aplaza la
 * asignación después del aviso, `updateAsignacion` limpia la marca, pero
 * aunque no lo hiciera una asignación que ahora es futura no puede sonar.
 *
 * `excluirUserId`: igual que el push, al responsable no se le avisa de lo suyo.
 */
async function listarAlarmasSinIniciar({ excluirUserId = 0 } = {}) {
  const limite = new Date(ahora().getTime() - AVISO_SIN_INICIAR_MINUTOS * 60 * 1000);
  const [filas] = await query(
    `SELECT al.id, al.fecha_inicio, al.estado, al.aviso_sin_iniciar_at,
            al.trabajo_id, t.nombre AS trabajo_nombre,
            v.alias AS vehiculo_alias, v.matricula,
            CONCAT(u.nombre,' ',u.apellidos) AS responsable_nombre,
            (SELECT GROUP_CONCAT(CONCAT(ru.nombre,' ',ru.apellidos) ORDER BY ra.orden SEPARATOR ', ')
               FROM asignacion_usuarios ra JOIN users ru ON ra.user_id = ru.id
              WHERE ra.asignacion_id = al.id AND ra.rol = 'responsable') AS responsables_nombres
       FROM asignaciones_libres al
       JOIN vehicles v ON v.id = al.vehicle_id
       JOIN users u    ON u.id = al.user_id
       LEFT JOIN trabajos t ON t.id = al.trabajo_id
      WHERE al.aviso_sin_iniciar_at IS NOT NULL
        AND al.inicio_real_at IS NULL
        AND al.estado IN ('programada', 'activa')
        AND al.deleted_at IS NULL
        AND al.fecha_inicio <= ?
        AND al.user_id <> ?
      ORDER BY al.fecha_inicio ASC, al.id ASC`,
    [limite, excluirUserId]
  );

  // Y las jornadas por día (v39) avisadas y sin iniciar, con la misma forma:
  // `fecha_inicio` es la de la jornada (la alarma pinta «Prevista HH:mm» y el
  // retraso) y `jornada_id` las distingue de la asignación en la app.
  const [jornadas] = await query(
    `SELECT al.id, j.id AS jornada_id, j.inicio AS fecha_inicio, al.estado,
            j.aviso_sin_iniciar_at,
            al.trabajo_id, t.nombre AS trabajo_nombre,
            v.alias AS vehiculo_alias, v.matricula,
            CONCAT(u.nombre,' ',u.apellidos) AS responsable_nombre,
            (SELECT GROUP_CONCAT(CONCAT(ru.nombre,' ',ru.apellidos) ORDER BY ra.orden SEPARATOR ', ')
               FROM asignacion_usuarios ra JOIN users ru ON ra.user_id = ru.id
              WHERE ra.asignacion_id = al.id AND ra.rol = 'responsable') AS responsables_nombres
       FROM asignacion_jornadas j
       JOIN asignaciones_libres al ON al.id = j.asignacion_id
       JOIN vehicles v ON v.id = al.vehicle_id
       JOIN users u    ON u.id = al.user_id
       LEFT JOIN trabajos t ON t.id = al.trabajo_id
      WHERE j.aviso_sin_iniciar_at IS NOT NULL
        AND j.inicio_real_at IS NULL
        AND j.fin > ?
        AND al.estado = 'activa'
        AND al.deleted_at IS NULL
        AND al.user_id <> ?
      ORDER BY j.inicio ASC, j.id ASC`,
    [ahora(), excluirUserId]
  );
  return [...filas, ...(jornadas || [])]
    .sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio));
}

// ============================================================
// Mantenimiento por km
// ============================================================

/** 44500 → «44.500». `toLocaleString('es-ES')` no agrupa los de cuatro cifras. */
function formatKm(n) {
  return String(Math.abs(Math.round(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Texto del push. Si el salto de km lo deja ya pasado, lo dice así. */
function avisoMantenimiento(v) {
  const nombre   = v.alias || v.matricula || 'Vehículo sin identificar';
  const quien    = v.alias && v.matricula ? `${v.alias} (${v.matricula})` : nombre;
  const faltan   = v.km_proximo_mantenimiento - v.kilometros_actuales;
  const objetivo = formatKm(v.km_proximo_mantenimiento);
  const km       = formatKm(v.kilometros_actuales);
  let cuerpo;
  if (faltan > 0)       cuerpo = `${quien} lleva ${km} km y le toca el mantenimiento a los ${objetivo}.`;
  else if (faltan === 0) cuerpo = `${quien} ha llegado a los ${objetivo} km: le toca el mantenimiento.`;
  else                  cuerpo = `${quien} lleva ${km} km: se ha pasado ${formatKm(faltan)} km del mantenimiento de los ${objetivo}.`;
  return {
    titulo: faltan > 0
      ? `${nombre}: mantenimiento en ${formatKm(faltan)} km`
      : `${nombre}: mantenimiento vencido`,
    cuerpo,
    url: `/vehiculos/${v.id}?tab=revisiones`,
    // Sin la referencia en el tag: el aviso del siguiente mantenimiento
    // sustituye en la bandeja al del anterior si aún siguiera ahí.
    tag: `veh-${v.id}-mantenimiento`,
  };
}

/**
 * Vehículos a los que les quedan MANTENIMIENTO_PUSH_KM (500) o menos para el
 * mantenimiento: push a administración UNA vez por referencia.
 *
 * El candado es `aviso_mantenimiento_km` (v38) y guarda la referencia avisada,
 * no un instante: un mantenimiento nuevo (o un ajuste a mano en la ficha)
 * mueve `km_proximo_mantenimiento`, la marca deja de coincidir y el aviso
 * vuelve a quedar armado para la referencia nueva sin que nadie limpie nada.
 *
 * Igual que el de «sin iniciar», las condiciones van también DENTRO del
 * UPDATE que reclama la fila: si entre el SELECT y el UPDATE alguien anota el
 * mantenimiento, la referencia ya no es la del SELECT y no se avisa de algo
 * resuelto.
 *
 * `kilometros_actuales + N >= km_proximo` y no una resta: las dos columnas son
 * UNSIGNED y en MySQL `a - b` con b > a da error de rango, no un negativo.
 * Km a 0 = «no anotado» (§2.9 del mapa), no se avisa.
 *
 * Nunca lanza.
 */
async function revisarMantenimientoKm() {
  const resumen = { candidatos: 0, avisados: 0 };

  try {
    const [candidatos] = await query(
      `SELECT id, alias, matricula, kilometros_actuales, km_proximo_mantenimiento
         FROM vehicles
        WHERE deleted_at IS NULL
          AND km_proximo_mantenimiento IS NOT NULL
          AND kilometros_actuales > 0
          AND kilometros_actuales + ? >= km_proximo_mantenimiento
          AND (aviso_mantenimiento_km IS NULL
               OR aviso_mantenimiento_km <> km_proximo_mantenimiento)`,
      [MANTENIMIENTO_PUSH_KM]
    );
    resumen.candidatos = candidatos.length;

    for (const v of candidatos) {
      const [res] = await query(
        `UPDATE vehicles
            SET aviso_mantenimiento_km = km_proximo_mantenimiento
          WHERE id = ?
            AND deleted_at IS NULL
            AND km_proximo_mantenimiento = ?
            AND kilometros_actuales + ? >= km_proximo_mantenimiento
            AND (aviso_mantenimiento_km IS NULL
                 OR aviso_mantenimiento_km <> km_proximo_mantenimiento)`,
        [v.id, v.km_proximo_mantenimiento, MANTENIMIENTO_PUSH_KM]
      );
      if (res.affectedRows === 0) continue;   // ya avisado o referencia movida

      resumen.avisados++;
      // Sin await, como el resto de avisos: el tick no espera al envío.
      push.notificarAdministracion(avisoMantenimiento(v));
    }

    if (resumen.avisados > 0) {
      logger.info(`Avisados ${resumen.avisados} vehículo(s) a ${MANTENIMIENTO_PUSH_KM} km o menos del mantenimiento`);
    }
  } catch (err) {
    logger.error(`Error vigilando el mantenimiento por km: ${err.message}`);
  }

  return resumen;
}

module.exports = {
  revisarAsignacionesSinIniciar,
  revisarJornadasSinIniciar,
  listarAlarmasSinIniciar,
  revisarMantenimientoKm,
  // Expuestos para los tests
  avisoMantenimiento,
  formatKm,
};
