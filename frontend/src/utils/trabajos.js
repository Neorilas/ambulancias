/**
 * utils/trabajos.js
 * El trabajo como padre (v33): el formulario del trabajo con sus ambulancias y
 * cómo se cuenta «tu ambulancia».
 *
 * Quién ve y quién hace qué lo decide el BACKEND (`vistaParaUsuario` en
 * trabajos.controller): cada ambulancia llega con `mi_rol` ('responsable' |
 * 'equipo' | null) y `detalle`, y el trabajo con `mi_rol` y `puede_cerrar`.
 * Aquí solo se traduce eso a pantalla, para no ofrecer lo que luego se
 * rechazaría.
 */

import { TRABAJO_ESTADOS } from './constants.js';
import { toInputDatetime, toUtcIso, formatDateTimeShort, formatHora } from './dateUtils.js';
import { idsElegidos, nombreMiembro } from './miembrosAsignacion.js';
import { parseKm } from './kmUtils.js';
import { esEnlaceGoogleMaps } from './mapas.js';
import { horarioDesdeApi, horarioAPayload, errorHorario, resumenJornadas, cruzaDias } from './jornadas.js';

const CERRADOS = [TRABAJO_ESTADOS.FINALIZADO, TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO];

export const estaCerrado = (estado) => CERRADOS.includes(estado);

/**
 * Una ambulancia del alta: es una asignación (vehículo, responsables y
 * equipo). Las fechas en blanco son las del trabajo.
 */
export const ambulanciaVacia = () => ({
  vehicle_id: '', responsables: [''], personal: [],
  fecha_inicio: '', fecha_fin: '', km_inicio: '', notas: '',
  // Sin horario propio, hereda el del trabajo en sus fechas (v39)
  horario_propio: false, horario: [],
});

/**
 * Estado inicial del formulario a partir de un trabajo (o ninguno). Las
 * ambulancias solo van en el alta, y pueden ser ninguna (2026-10-10): después
 * se añaden y se cambian una a una desde la ficha del trabajo. `usuarios` es
 * el equipo del trabajo: la gente asignada, vaya o no en una ambulancia.
 */
export function formularioInicial(trabajo) {
  return {
    nombre:       trabajo?.nombre      || '',
    descripcion:  trabajo?.descripcion || '',
    ubicacion:    trabajo?.ubicacion   || '',
    ubicacion_url: trabajo?.ubicacion_url || '',
    tipo:         trabajo?.tipo        || 'traslado',
    fecha_inicio: toInputDatetime(trabajo?.fecha_inicio) || '',
    fecha_fin:    toInputDatetime(trabajo?.fecha_fin)    || '',
    // Horas del evento (v42), 'HH:mm' en hora española: el día es el del
    // trabajo, porque solo se piden en los de un día
    evento_desde: toInputDatetime(trabajo?.evento_inicio).slice(11),
    evento_hasta: toInputDatetime(trabajo?.evento_fin).slice(11),
    // 1..N coordinadores (v35), el principal primero; sin ninguno (el alta),
    // una fila vacía para elegirlo
    coordinadores: coordinadoresDe(trabajo).length ? coordinadoresDe(trabajo).map(c => c.id) : [''],
    usuarios:     (trabajo?.usuarios || []).map(u => u.user_id),
    // El horario por días (v39), en días y tramos de hora española
    horario:      horarioDesdeApi(trabajo?.horario),
    asignaciones: [],
    // Previsto (v41): entra a semanas vista sin ambulancia ni coordinador. En
    // el alta lo marca quien lo crea; al editar, lo dice el estado del trabajo
    previsto:     trabajo?.estado === TRABAJO_ESTADOS.PREVISTO,
  };
}

/**
 * Las ambulancias abiertas (programada o activa) que acaban a la vez que el
 * trabajo: las que se alargan con él si se le cambia el fin con la casilla
 * de «Editar trabajo» (`mover_fin_ambulancias`, mismo criterio que
 * `updateTrabajo`: al minuto).
 */
export function ambulanciasQueAcabanConElTrabajo(trabajo) {
  const fin = toInputDatetime(trabajo?.fecha_fin);
  if (!fin) return [];
  return (trabajo.asignaciones || []).filter(a =>
    (a.estado === 'programada' || a.estado === 'activa') && toInputDatetime(a.fecha_fin) === fin);
}

/** ¿Es un trabajo previsto (v41), aún sin coordinador o sin ambulancias? */
export const esPrevisto = (trabajo) => trabajo?.estado === TRABAJO_ESTADOS.PREVISTO;

/**
 * Lo que le falta a un trabajo previsto para pasar a programado, que el
 * backend hace solo en cuanto tiene las dos cosas (`previstoCompleto` en
 * estadoTrabajo.service): ['coordinador', 'ambulancia'], o lo que quede.
 */
export function faltaParaProgramado(trabajo) {
  if (!esPrevisto(trabajo)) return [];
  const falta = [];
  if (!coordinadoresDe(trabajo).length) falta.push('coordinador');
  if (!(trabajo.asignaciones || []).some(a => a.estado !== 'cancelada')) falta.push('ambulancia');
  return falta;
}

/**
 * ¿Se piden las horas del evento (v42)? Solo en un trabajo de un día: en los
 * de varios, el horario por días hace de horario del evento.
 */
export const pideEvento = (form) => !cruzaDias(form.fecha_inicio, form.fecha_fin);

/** Las horas del evento del formulario como 'yyyy-MM-ddTHH:mm' locales, o null. */
function eventoLocal(form) {
  if (!pideEvento(form) || !form.fecha_inicio) return null;
  const dia = form.fecha_inicio.slice(0, 10);
  const desde = form.evento_desde || '';
  const hasta = form.evento_hasta || '';
  if (!desde && !hasta) return null;
  return { inicio: desde && `${dia}T${desde}`, fin: hasta && `${dia}T${hasta}` };
}

/** El fallo de las horas del evento, el mismo criterio que `leerEvento` del backend. */
function errorEvento(form) {
  const ev = eventoLocal(form);
  if (!ev) return null;
  if (!ev.inicio || !ev.fin) return 'Pon la hora de inicio y la de fin del evento, o ninguna';
  if (ev.fin <= ev.inicio) return 'El fin del evento tiene que ser posterior a su inicio';
  if (ev.inicio < form.fecha_inicio || (form.fecha_fin && ev.fin > form.fecha_fin)) {
    return 'El evento tiene que caer entre el inicio y el fin del trabajo';
  }
  return null;
}

/** Siempre las dos: sin evento (o en uno de varios días) van a null y se borran. */
function eventoAPayload(form) {
  const ev = eventoLocal(form);
  return ev?.inicio && ev?.fin
    ? { evento_inicio: toUtcIso(ev.inicio), evento_fin: toUtcIso(ev.fin) }
    : { evento_inicio: null, evento_fin: null };
}

/** Las horas del evento para enseñar («11:00 – 12:00»), o null si no tiene. */
export function textoEvento(trabajo) {
  if (!trabajo?.evento_inicio || !trabajo?.evento_fin) return null;
  return `${formatHora(trabajo.evento_inicio)} – ${formatHora(trabajo.evento_fin)}`;
}

/**
 * Hasta cuándo estaba previsto el evento de una ambulancia: el fin del evento
 * de su trabajo si lo tiene (v42) y, si no, su propio fin. Decide si
 * «Fin evento/servicio» y «Finalizar asignación» piden el motivo de fin
 * anticipado. Espejo de `finEventoPrevisto` en asignaciones.controller.
 */
export const finEventoPrevisto = (asig) => asig?.trabajo?.evento_fin || asig?.fecha_fin;

/** Errores del formulario, por campo. Vacío = se puede guardar. */
export function validarTrabajo(form, { alta = false } = {}) {
  const e = {};
  if (!form.nombre.trim())  e.nombre       = 'Nombre requerido';
  if (!form.fecha_inicio)   e.fecha_inicio = 'Fecha inicio requerida';
  if (!form.fecha_fin)      e.fecha_fin    = 'Fecha fin requerida';
  if (form.fecha_fin && form.fecha_inicio && form.fecha_fin <= form.fecha_inicio) {
    e.fecha_fin = 'Fecha fin debe ser posterior a fecha inicio';
  }
  const malEvento = errorEvento(form);
  if (malEvento) e.evento = malEvento;
  if (form.ubicacion.length > 255) e.ubicacion = 'Máximo 255 caracteres';
  if ((form.ubicacion_url || '').trim() && !esEnlaceGoogleMaps(form.ubicacion_url)) {
    e.ubicacion_url = 'Tiene que ser un enlace de Google Maps (el de «Compartir»)';
  }
  // Un previsto puede no tenerlo aún: es justo lo que le falta
  if (!form.previsto && !idsElegidos(form.coordinadores).length) {
    e.coordinadores = 'Elige quién coordina el trabajo';
  }
  const malHorario = errorHorario(form.horario, form.fecha_inicio, form.fecha_fin);
  if (malHorario) e.horario = malHorario;
  if (!alta) return e;

  // Las ambulancias son opcionales; las que se añadan, completas
  const ambs = form.asignaciones || [];
  const ids  = ambs.map(a => parseInt(a.vehicle_id, 10));
  if (ambs.some((a, i) => !ids[i] || !idsElegidos(a.responsables).length)) {
    e.asignaciones = 'Cada ambulancia necesita el vehículo y al menos un responsable';
  } else if (new Set(ids).size !== ids.length) {
    e.asignaciones = 'La misma ambulancia está dos veces';
  } else if (ambs.some(a => {
    // En blanco, la del trabajo: es la que guardará el backend
    const ini = a.fecha_inicio || form.fecha_inicio;
    const fin = a.fecha_fin    || form.fecha_fin;
    return ini && fin && fin <= ini;
  })) {
    e.asignaciones = 'En cada ambulancia, el fin tiene que ser posterior al inicio';
  } else {
    const propia = ambs.map(a => a.horario_propio && errorHorario(a.horario,
      a.fecha_inicio || form.fecha_inicio, a.fecha_fin || form.fecha_fin)).find(Boolean);
    if (propia) e.asignaciones = `Horario propio de una ambulancia: ${propia}`;
  }
  return e;
}

/**
 * Lo que se manda al backend: los datos, los coordinadores y el equipo del
 * trabajo (`usuarios`); en el alta, además, sus ambulancias. Nunca
 * `vehiculos`: es el formato del modelo anterior y el backend daría 400.
 * Sin coordinadores (solo un previsto) no se mandan: una lista vacía da 422,
 * el backend exige al menos uno cuando viene.
 */
export function payloadTrabajo(form, { alta = false } = {}) {
  const datos = {
    nombre:       form.nombre.trim(),
    descripcion:  form.descripcion.trim() || null,
    ubicacion:    form.ubicacion.trim()   || null,
    ubicacion_url: (form.ubicacion_url || '').trim() || null,
    tipo:         form.tipo,
    fecha_inicio: toUtcIso(form.fecha_inicio),
    fecha_fin:    toUtcIso(form.fecha_fin),
    ...eventoAPayload(form),
    usuarios:     idsElegidos(form.usuarios),
    horario:      horarioAPayload(form.horario),
  };
  const coordinadores = idsElegidos(form.coordinadores);
  if (coordinadores.length) datos.coordinadores = coordinadores;
  if (!alta) return datos;
  return {
    ...datos,
    ...(form.previsto ? { previsto: true } : {}),
    asignaciones: form.asignaciones.map(a => ({
      vehicle_id:   parseInt(a.vehicle_id, 10),
      responsables: idsElegidos(a.responsables),
      personal:     idsElegidos(a.personal),
      // Sin fecha propia, el backend le pone la del trabajo
      ...(a.fecha_inicio ? { fecha_inicio: toUtcIso(a.fecha_inicio) } : {}),
      ...(a.fecha_fin    ? { fecha_fin:    toUtcIso(a.fecha_fin) }    : {}),
      km_inicio:    parseKm(a.km_inicio),
      notas:        a.notas.trim() || null,
      // Con `horario`, la ambulancia lleva el suyo; sin él, el del trabajo
      ...(a.horario_propio ? { horario: horarioAPayload(a.horario) } : {}),
    })),
  };
}

/**
 * Las ambulancias del trabajo en las que va quien mira, primero la que lleva
 * como responsable (puede ir en dos: D5 es por ambulancia, no por persona).
 */
export function misAmbulancias(trabajo) {
  const orden = a => (a.mi_rol === 'responsable' ? 0 : 1);
  return (trabajo?.asignaciones || []).filter(a => a.mi_rol).sort((a, b) => orden(a) - orden(b));
}

/**
 * El siguiente paso de una ambulancia, para quien la lleva. Es el texto del
 * botón de «Tu ambulancia»: el botón abre la operación de siempre (el detalle
 * de la asignación) y las acciones de verdad están allí (D7). La llegada y el
 * fin del evento son opcionales, pero son lo siguiente que se hace.
 */
export function siguientePaso(a) {
  if (!a || a.estado === 'finalizada' || a.estado === 'cancelada') return null;
  if (!a.inicio_real_at) return 'Inicio de la asignación';
  if (a.progreso_fotos && !a.progreso_fotos.inicio?.completo) return 'Fotos de inicio';
  // Con horario por días (v39), cada día «Inicio/Fin de jornada» en vez del evento
  const j = resumenJornadas(a);
  if (j.total) {
    if (j.enCurso) return 'Fin de jornada';
    return j.hechas < j.total ? 'Inicio de jornada' : 'Finalizar asignación';
  }
  if (!a.llegada_servicio_at) return 'Inicio evento/servicio';
  if (!a.fin_servicio_at) return 'Fin evento/servicio';
  return 'Finalizar asignación';
}

/** En qué punto está una ambulancia, en palabras de campo. */
export function textoEstadoAmbulancia(a) {
  if (!a) return '';
  switch (a.estado) {
    case 'cancelada':  return 'Cancelada';
    case 'finalizada': return 'Finalizada';
    case 'programada': return `Programada · empieza ${formatDateTimeShort(a.fecha_inicio)}`;
    default:
      if (!a.inicio_real_at) return 'Sin iniciar';
      if (a.progreso_fotos && !a.progreso_fotos.inicio?.completo) return 'Iniciada · faltan fotos de inicio';
      if (resumenJornadas(a).total) {
        const j = resumenJornadas(a);
        // «hechas», como la barra de pasos: las dos cuentan lo mismo
        return j.enCurso ? `En jornada · ${j.hechas} de ${j.total} hechas` : `Jornadas: ${j.hechas} de ${j.total} hechas`;
      }
      if (a.fin_servicio_at) return 'De vuelta a base';
      if (a.llegada_servicio_at) return 'En el evento/servicio';
      return 'En camino';
  }
}

/**
 * Los coordinadores de un trabajo (v35: 1..N, todos con las mismas
 * funciones), el principal primero. Un backend anterior solo manda el
 * principal suelto (`coordinador`).
 */
export function coordinadoresDe(trabajo) {
  if (trabajo?.coordinadores) return trabajo.coordinadores;
  return trabajo?.coordinador ? [trabajo.coordinador] : [];
}

/** ¿Es este usuario uno de los coordinadores del trabajo? */
export function esCoordinadorDe(trabajo, userId) {
  return userId != null && coordinadoresDe(trabajo).some(c => c.id === userId);
}

/**
 * La gente ya asociada a un trabajo: su equipo, sus coordinadores y quien va en
 * alguna de sus ambulancias (las canceladas no cuentan). Es lo que sale
 * arriba, en «Asociados al trabajo», al elegir quién va en una ambulancia.
 */
function juntarAsociados(equipo, coordinadores, ambulancias) {
  return new Set(idsElegidos([
    ...(equipo || []),
    ...(coordinadores || []),
    ...(ambulancias || []).flatMap(a => [...(a.responsables || []), ...(a.personal || [])]),
  ]));
}

/** Desde un trabajo cargado (ficha), al añadirle una ambulancia. */
export function asociadosDeTrabajo(trabajo) {
  if (!trabajo) return new Set();
  const ids = lista => (lista || []).map(m => m.id);
  return juntarAsociados(
    (trabajo.usuarios || []).map(u => u.user_id),
    coordinadoresDe(trabajo).map(c => c.id),
    (trabajo.asignaciones || [])
      .filter(a => a.estado !== 'cancelada')
      .map(a => ({ responsables: ids(a.responsables), personal: ids(a.personal) })),
  );
}

/** Desde el formulario de alta: lo que ya se ha rellenado en él. */
export function asociadosDeFormulario(form) {
  return juntarAsociados(form?.usuarios, form?.coordinadores, form?.asignaciones);
}

/** Nombres de una lista de personas: «Ana Ruiz, Luis Gil». */
export function nombresDe(lista) {
  return (lista || []).map(nombreMiembro).filter(Boolean).join(', ');
}

/** Nombres de los responsables de una ambulancia (o de un vehículo v25). */
export function nombresResponsables(v) {
  return nombresDe(v?.responsables);
}

/**
 * Las ambulancias de una fila del listado (`vehiculos_nombres`, separadas por
 * «|»), sin repetir y en castellano: «UVI-05», «UVI-04 y UVI-03»,
 * «UVI-01, UVI-02 y SVB-1». Cadena vacía si no lleva ninguna.
 */
export function ambulanciasDeFila(fila) {
  const nombres = [...new Set(
    String(fila?.vehiculos_nombres || '').split('|').map(n => n.trim()).filter(Boolean),
  )];
  if (nombres.length < 2) return nombres[0] || '';
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

// ── Modelo v25 (convive hasta la fase 6; lo usa TrabajoV25) ─────────────────

/**
 * Qué toca hacer con UN vehículo de un trabajo v25, desde el punto de vista
 * de quien mira. Solo hay acciones en los vehículos con `detalle` (gestión o
 * responsable de ese vehículo): el equipo no activa ni cierra nada.
 *
 * @returns {{activar: boolean, fotosInicio: boolean, finalizar: boolean}}
 */
export function accionesVehiculo(v) {
  const nada = { activar: false, fotosInicio: false, finalizar: false };
  if (!v?.detalle || estaCerrado(v.estado)) return nada;
  const inicioCompleto = !!v.progreso_fotos?.inicio?.completo;
  return {
    // Activar = «inicio de servicio»: vale también si el cron ya lo pasó a
    // activo y nadie ha pulsado todavía (inicio_real_at sin sellar).
    activar:     !v.inicio_real_at,
    fotosInicio: !inicioCompleto,
    finalizar:   inicioCompleto,
  };
}

/** Vehículos v25 en los que quien mira tiene algo pendiente. */
export function vehiculosConAcciones(trabajo) {
  return (trabajo?.vehiculos || []).filter(v => {
    const a = accionesVehiculo(v);
    return a.activar || a.fotosInicio || a.finalizar;
  });
}
