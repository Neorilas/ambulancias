/**
 * services/avisosAsignacion.service.js
 * Los avisos push que genera una asignación, con su texto y su tag.
 *
 * Están juntos y fuera de los controladores porque los dispara gente distinta:
 * la activación puede venir del cron (`server.js`) o del botón del técnico
 * (`asignaciones.controller.js`), y si cada sitio compusiera su propio texto
 * acabarían diciendo cosas distintas del mismo suceso.
 *
 * Todos excluyen al responsable de la asignación: quien acaba de pulsar el
 * botón no necesita que su propio teléfono le avise de lo que acaba de hacer.
 * También el de «sin iniciar», aunque ahí el responsable sea justo quien no ha
 * hecho lo que se espera: lo pedido fue avisar a los administradores, que son
 * quienes pueden reaccionar desde fuera. Si algún día se quiere avisar también
 * al técnico, es quitar ese `excluirUserId` — pero es otra decisión.
 *
 * Se invocan SIN await: el técnico no tiene por qué esperar a que el servicio
 * de push del fabricante conteste para ver cerrado su servicio. Por eso
 * ninguna puede rechazar nunca — una promesa rechazada y sin dueño mata el
 * proceso, que es lo que hace `process.on('unhandledRejection')` en server.js.
 * `push.notificarAdmins` ya captura lo suyo; `disparar` es el segundo cierre.
 */

'use strict';

const push   = require('./push.service');
const logger = require('../utils/logger.utils');

/** Red de seguridad: ningún aviso puede acabar en una promesa rechazada. */
function disparar(promesa) {
  return Promise.resolve(promesa).catch((err) => {
    logger.error(`Aviso de asignación no enviado: ${err?.message || err}`);
    return { enviados: 0, borrados: 0, fallidos: 0, omitido: 'error' };
  });
}

/**
 * Cómo se nombra al vehículo en el aviso.
 *
 * Manda el alias: el personal identifica la ambulancia por su nombre, no por
 * la matrícula (ver `vehicles.alias` en el mapa del código). La matrícula es
 * el respaldo para las que todavía no tienen nombre puesto.
 */
function etiquetaVehiculo(asig) {
  return asig?.vehiculo_alias || asig?.matricula || 'Vehículo sin identificar';
}

/** Nombre del técnico responsable, tal y como se pinta en la app. */
function etiquetaResponsable(asig) {
  return asig?.responsable_nombre || asig?.responsable_username || 'Sin responsable';
}

/**
 * Ruta de la PWA que se abre al tocar el aviso.
 *
 * `/asignaciones` es el listado de gestión, que es donde tiene sentido caer
 * viniendo de un aviso: el admin llega para revisar lo que acaba de pasar.
 */
function urlAsignacion(asig) {
  return `/asignaciones?id=${asig.id}`;
}

// ============================================================
// Los eventos
// ============================================================

/** La asignación pasa a activa: por el cron al llegar la fecha o por el botón. */
function avisarAsignacionActivada(asig) {
  return disparar(push.notificarAdmins({
    titulo:        `${etiquetaVehiculo(asig)} · servicio iniciado`,
    cuerpo:        `${etiquetaResponsable(asig)} ha iniciado el servicio.`,
    url:           urlAsignacion(asig),
    // Un tag por asignación Y evento: así el aviso de inicio no tapa al de
    // fotos completas, y repetir el mismo evento no apila duplicados.
    tag:           `asig-${asig.id}-activada`,
    excluirUserId: asig.user_id,
  }));
}

/** Las fotos de inicio ya están todas subidas. */
function avisarFotosInicioCompletas(asig) {
  return disparar(push.notificarAdmins({
    titulo:        `${etiquetaVehiculo(asig)} · fotos de inicio completas`,
    cuerpo:        `${etiquetaResponsable(asig)} ha subido todas las fotos de inicio.`,
    url:           urlAsignacion(asig),
    tag:           `asig-${asig.id}-fotos-inicio`,
    excluirUserId: asig.user_id,
  }));
}

/**
 * Ha pasado la hora prevista y nadie ha iniciado la asignación.
 *
 * Es el único de los avisos que no cuenta algo que alguien acaba de hacer,
 * sino algo que NO ha pasado, así que no lo dispara ninguna petición: lo saca
 * el cron (`services/vigilancia.service.js`). Por eso importa tanto que se
 * mande una sola vez — el cron vuelve a mirar cada minuto.
 *
 * «Iniciada» es `inicio_real_at`, o sea que el responsable haya pulsado
 * «Inicio de servicio». Que el cron la haya puesto en `activa` al llegar la
 * hora no cuenta: eso lo hace el reloj, no una persona, y la asignación
 * activada sola a la que nadie entra es exactamente el caso a vigilar.
 */
function avisarAsignacionSinIniciar(asig, { minutos } = {}) {
  return disparar(push.notificarAdmins({
    titulo:        `${etiquetaVehiculo(asig)} · servicio sin iniciar`,
    cuerpo:        `${etiquetaResponsable(asig)} no ha iniciado el servicio y ya han pasado ${minutos} min de la hora prevista.`,
    url:           urlAsignacion(asig),
    tag:           `asig-${asig.id}-sin-iniciar`,
    excluirUserId: asig.user_id,
  }));
}

/**
 * Servicio cerrado.
 *
 * Este aviso vale también por el de «fotos de fin completas»: no se puede
 * finalizar sin tenerlas todas, así que mandar los dos sería hacer sonar el
 * teléfono dos veces por lo mismo.
 */
function avisarAsignacionFinalizada(asig, { km_fin } = {}) {
  // Los km son opcionales al cerrar una asignación. Ojo con el atajo
  // `Number.isFinite(Number(km_fin))` a secas: `Number(null)` y `Number('')`
  // valen 0, y el aviso habría anunciado «0 km» cada vez que no se anotaron.
  const hayKm = km_fin !== null && km_fin !== undefined && km_fin !== ''
                && Number.isFinite(Number(km_fin));
  const km = hayKm ? ` · ${Number(km_fin).toLocaleString('es-ES')} km` : '';
  return disparar(push.notificarAdmins({
    titulo:        `${etiquetaVehiculo(asig)} · servicio finalizado`,
    cuerpo:        `${etiquetaResponsable(asig)} ha finalizado el servicio con fotos${km}.`,
    url:           urlAsignacion(asig),
    tag:           `asig-${asig.id}-finalizada`,
    excluirUserId: asig.user_id,
  }));
}

module.exports = {
  avisarAsignacionActivada,
  avisarFotosInicioCompletas,
  avisarAsignacionSinIniciar,
  avisarAsignacionFinalizada,
  etiquetaVehiculo,
  etiquetaResponsable,
};
