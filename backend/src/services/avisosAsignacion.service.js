/**
 * services/avisosAsignacion.service.js
 * Los avisos push que genera una asignación, con su texto y su tag.
 *
 * Están juntos y fuera de los controladores porque los dispara gente distinta:
 * la activación puede venir del cron (`server.js`) o del botón del técnico
 * (`asignaciones.controller.js`), y si cada sitio compusiera su propio texto
 * acabarían diciendo cosas distintas del mismo suceso.
 *
 * Todos van a los administradores salvo `avisarAsignacionNueva` y
 * `avisarCambioVehiculo`, que van a los miembros de la asignación, y
 * `avisarTrabajoPendienteCierre`, al coordinador del trabajo. Los de administradores excluyen al
 * responsable de la asignación: quien acaba de pulsar el
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
const { diaYHoraEnEspana, instanteUtc } = require('../utils/fecha.utils');

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
  // Una asignación puede tener varios responsables (v23): se nombran todos,
  // porque el aviso no sabe cuál de ellos ha pulsado el botón.
  const nombres = Array.isArray(asig?.responsables) && asig.responsables.length
    ? asig.responsables.map(r => [r.nombre, r.apellidos].filter(Boolean).join(' ') || r.username)
    : null;
  if (nombres) return nombres.length === 1 ? nombres[0]
    : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
  return asig?.responsables_nombres || asig?.responsable_nombre
      || asig?.responsable_username || 'Sin responsable';
}

/**
 * « en «Maratón»» si la asignación es de un trabajo, o nada. Vale tanto con
 * la asignación completa (`trabajo.nombre`) como con una fila de listado o
 * del cron (`trabajo_nombre`).
 */
function enTrabajo(asig) {
  const nombre = asig?.trabajo?.nombre || asig?.trabajo_nombre;
  return nombre ? ` en «${nombre}»` : '';
}

/** Id del trabajo de la asignación, o null si es del modelo antiguo. */
function trabajoDe(asig) {
  return asig?.trabajo_id || asig?.trabajo?.id || null;
}

/**
 * Ruta de la PWA que se abre al tocar el aviso (D10 del plan del trabajo
 * padre): la del TRABAJO, con esa ambulancia señalada, que es donde está todo
 * lo demás. Las asignaciones antiguas, sin trabajo, siguen yendo a
 * `/asignaciones`, el listado de gestión, que es donde tiene sentido caer
 * viniendo de un aviso: el admin llega para revisar lo que acaba de pasar.
 */
function urlAsignacion(asig) {
  const trabajoId = trabajoDe(asig);
  return trabajoId ? `/trabajos/${trabajoId}?asignacion=${asig.id}` : `/asignaciones?id=${asig.id}`;
}

/**
 * La de los avisos que van al técnico. Con trabajo, la misma que la de
 * gestión: la ficha del trabajo es también su pantalla. Sin trabajo,
 * `/mis-asignaciones`, que es la que tiene; `/asignaciones` le rebotaría.
 */
function urlParaMiembros(asig) {
  return trabajoDe(asig) ? urlAsignacion(asig) : '/mis-asignaciones';
}

// ============================================================
// Los eventos
// ============================================================

/** La asignación pasa a activa: por el cron al llegar la fecha o por el botón. */
function avisarAsignacionActivada(asig) {
  return disparar(push.notificarAdmins({
    titulo:        `${etiquetaVehiculo(asig)} · asignación iniciada`,
    cuerpo:        `${etiquetaResponsable(asig)} ha iniciado la asignación${enTrabajo(asig)}.`,
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
    cuerpo:        `${etiquetaResponsable(asig)} ha subido todas las fotos de inicio${enTrabajo(asig)}.`,
    url:           urlAsignacion(asig),
    tag:           `asig-${asig.id}-fotos-inicio`,
    excluirUserId: asig.user_id,
  }));
}

/**
 * «Inicio evento/servicio»: la ambulancia ya está en el evento. La hora la sella
 * el botón; aquí solo se cuenta.
 */
function avisarLlegadaEvento(asig) {
  return disparar(push.notificarAdmins({
    titulo:        `${etiquetaVehiculo(asig)} · inicio evento/servicio`,
    cuerpo:        `${etiquetaResponsable(asig)} ha llegado al evento/servicio${enTrabajo(asig)}.`,
    url:           urlAsignacion(asig),
    tag:           `asig-${asig.id}-llegada`,
    excluirUserId: asig.user_id,
  }));
}

/**
 * «Fin evento/servicio»: se ha terminado en el sitio y la ambulancia
 * vuelve a base. NO es el cierre de la asignación (`avisarAsignacionFinalizada`),
 * que llega después, con las fotos de fin; de ahí el texto distinto.
 */
function avisarFinEvento(asig) {
  return disparar(push.notificarAdmins({
    titulo:        `${etiquetaVehiculo(asig)} · fin evento/servicio`,
    cuerpo:        `${etiquetaResponsable(asig)} ha terminado en el evento/servicio${enTrabajo(asig)} y vuelve a base.`,
    url:           urlAsignacion(asig),
    tag:           `asig-${asig.id}-fin-evento`,
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
 * «Inicio de la asignación». Que el cron la haya puesto en `activa` al llegar la
 * hora no cuenta: eso lo hace el reloj, no una persona, y la asignación
 * activada sola a la que nadie entra es exactamente el caso a vigilar.
 *
 * Es el único con `prioridad: 'alta'`: el móvil lo pinta distinto del resto
 * (URGENTE en el título, icono de aviso en la barra de estado, vibración más
 * larga y botón «Ver servicio»). El sonido NO cambia — lo pone el sistema y
 * una web no puede elegirlo (§2.5 del mapa).
 */
function avisarAsignacionSinIniciar(asig, { minutos } = {}) {
  return disparar(push.notificarAdmins({
    titulo:        `URGENTE · ${etiquetaVehiculo(asig)} sin iniciar`,
    cuerpo:        `${etiquetaResponsable(asig)} no ha iniciado la asignación${enTrabajo(asig)} y ya han pasado ${minutos} min de la hora prevista.`,
    url:           urlAsignacion(asig),
    tag:           `asig-${asig.id}-sin-iniciar`,
    prioridad:     'alta',
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
    titulo:        `${etiquetaVehiculo(asig)} · asignación finalizada`,
    cuerpo:        `${etiquetaResponsable(asig)} ha finalizado la asignación${enTrabajo(asig)} con fotos${km}.`,
    url:           urlAsignacion(asig),
    tag:           `asig-${asig.id}-finalizada`,
    excluirUserId: asig.user_id,
  }));
}

/**
 * Te han asignado un servicio: a los MIEMBROS de la asignación, no a los
 * admins. Con `avisarCambioVehiculo`, los únicos que van hacia el técnico.
 *
 * `nuevos` son los ids a avisar: todos al crear, y al editar solo los que
 * entran (quien ya iba no tiene nada nuevo que saber). Se reparte por papel
 * porque el texto cambia: el responsable es quien arranca el servicio.
 *
 * `asignadoPor` se excluye: el admin que se pone a sí mismo en el equipo
 * acaba de hacerlo y no necesita que le suene el teléfono.
 *
 * La ruta es la del trabajo si la asignación tiene uno, y si no
 * `/mis-asignaciones` (`urlParaMiembros`).
 */
function avisarAsignacionNueva(asig, nuevos = [], opciones = {}) {
  // El controlador la llama sin await y DESPUÉS de guardar: si la parte
  // síncrona (fecha, forma de `asig`) lanzara, el error subiría a su catch y
  // la API contestaría error con la asignación ya creada. `disparar` solo
  // cubre la promesa, así que aquí va un segundo cierre.
  try {
    return componerAsignacionNueva(asig, nuevos, opciones);
  } catch (err) {
    logger.error(`Aviso de nuevo servicio no enviado: ${err?.message || err}`);
    return Promise.resolve([]);
  }
}

function componerAsignacionNueva(asig, nuevos, { asignadoPor = null } = {}) {
  const avisar = new Set((nuevos || []).map(Number).filter(id => id !== Number(asignadoPor)));
  if (!avisar.size) return Promise.resolve([]);

  const inicio = asig?.fecha_inicio ? diaYHoraEnEspana(new Date(asig.fecha_inicio)) : null;
  const cuando = inicio ? ` Empieza el ${inicio}.` : '';
  const ids = lista => (lista || []).map(m => m.id).filter(id => avisar.has(id));
  // Red de seguridad igual que rolEnAsignacion: sin filas de miembros, el
  // principal cuenta como responsable.
  const responsables = (asig?.responsables?.length ? ids(asig.responsables)
    : [asig?.user_id].filter(id => avisar.has(id)));
  const personal = ids(asig?.personal);

  const envios = [];
  if (responsables.length) {
    envios.push(disparar(push.notificarUsuarios(responsables, {
      titulo: `${etiquetaVehiculo(asig)} · nuevo servicio`,
      cuerpo: `Te han asignado un servicio como responsable${enTrabajo(asig)}.${cuando}`,
      url:    urlParaMiembros(asig),
      tag:    `asig-${asig.id}-asignada`,
    })));
  }
  if (personal.length) {
    envios.push(disparar(push.notificarUsuarios(personal, {
      titulo: `${etiquetaVehiculo(asig)} · nuevo servicio`,
      cuerpo: `Te han asignado un servicio con ${etiquetaResponsable(asig)}${enTrabajo(asig)}.${cuando}`,
      url:    urlParaMiembros(asig),
      tag:    `asig-${asig.id}-asignada`,
    })));
  }
  return Promise.all(envios);
}

/**
 * Gestión ha cambiado la ambulancia de la asignación. El flujo real es que el
 * técnico llama porque la suya no le vale; este aviso es la confirmación de
 * que ya está hecho y de cuál es la nueva. Va a los miembros que ya estaban
 * (`ids`), menos a quien hizo el cambio.
 *
 * Mismo tag que el «nuevo servicio»: si el técnico aún tiene ese aviso con la
 * ambulancia vieja en la bandeja, este lo sustituye en lugar de convivir con él.
 */
function avisarCambioVehiculo(asig, ids = [], { anterior = null, cambiadoPor = null } = {}) {
  try {
    const avisar = (ids || []).map(Number).filter(id => id !== Number(cambiadoPor));
    if (!avisar.length) return Promise.resolve(null);
    const antes = anterior ? ` (antes ${etiquetaVehiculo(anterior)})` : '';
    return disparar(push.notificarUsuarios(avisar, {
      titulo: `${etiquetaVehiculo(asig)} · cambio de vehículo`,
      cuerpo: `Tu asignación${enTrabajo(asig)} pasa a ${etiquetaVehiculo(asig)}${antes}. Las fotos de inicio se hacen a esta.`,
      url:    urlParaMiembros(asig),
      tag:    `asig-${asig.id}-asignada`,
    }));
  } catch (err) {
    logger.error(`Aviso de cambio de vehículo no enviado: ${err?.message || err}`);
    return Promise.resolve(null);
  }
}

/**
 * Todas las ambulancias del trabajo han finalizado: falta que el coordinador
 * lo cierre (D3). Va SOLO al coordinador, que es quien lo cierra; un trabajo
 * de antes de v33 no tiene, y entonces va a gestión.
 *
 * Lo dispara `estadoTrabajo.avisarSiPendienteCierre` tras ver el salto a
 * `pendiente_cierre` en el UPDATE (que lleva `estado <> ?`): dos cierres de
 * ambulancia cruzados no avisan dos veces.
 */
function avisarTrabajoPendienteCierre(trabajo) {
  try {
    const aviso = {
      titulo: `${trabajo.nombre} · listo para cerrar`,
      cuerpo: 'Todas las ambulancias han finalizado. Revisa el trabajo y ciérralo.',
      url:    `/trabajos/${trabajo.id}`,
      tag:    `trab-${trabajo.id}-pendiente-cierre`,
    };
    return disparar(trabajo.coordinador_user_id
      ? push.notificarUsuarios([trabajo.coordinador_user_id], aviso)
      : push.notificarAdmins(aviso));
  } catch (err) {
    logger.error(`Aviso de trabajo pendiente de cierre no enviado: ${err?.message || err}`);
    return Promise.resolve(null);
  }
}

/**
 * Te han puesto en el equipo de un trabajo (2026-10-10): la gente asignada al
 * trabajo, vaya o no todavía en una ambulancia. A quien ENTRA, menos a quien
 * lo hace; quien además va en una ambulancia ya recibe el «nuevo servicio» y
 * lo quita quien llama. Abre la ficha del trabajo.
 */
function avisarEquipoTrabajo(trabajo, ids = [], { asignadoPor = null } = {}) {
  try {
    const avisar = [...new Set((ids || []).map(Number))].filter(id => id !== Number(asignadoPor));
    if (!avisar.length) return Promise.resolve(null);
    // instanteUtc: puede llegar el texto del body (UTC sin zona) o un Date de BD
    const inicio = trabajo?.fecha_inicio ? diaYHoraEnEspana(instanteUtc(trabajo.fecha_inicio)) : null;
    return disparar(push.notificarUsuarios(avisar, {
      titulo: `${trabajo.nombre} · nuevo trabajo`,
      cuerpo: `Te han puesto en el equipo del trabajo.${inicio ? ` Empieza el ${inicio}.` : ''}`,
      url:    `/trabajos/${trabajo.id}`,
      tag:    `trab-${trabajo.id}-equipo`,
    }));
  } catch (err) {
    logger.error(`Aviso de equipo del trabajo no enviado: ${err?.message || err}`);
    return Promise.resolve(null);
  }
}

module.exports = {
  avisarAsignacionNueva,
  avisarEquipoTrabajo,
  avisarCambioVehiculo,
  avisarAsignacionActivada,
  avisarFotosInicioCompletas,
  avisarLlegadaEvento,
  avisarFinEvento,
  avisarAsignacionSinIniciar,
  avisarAsignacionFinalizada,
  avisarTrabajoPendienteCierre,
  etiquetaVehiculo,
  etiquetaResponsable,
  urlAsignacion,
  urlParaMiembros,
};
