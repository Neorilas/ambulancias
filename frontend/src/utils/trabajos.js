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
import { toInputDatetime, toUtcIso, formatDateTimeShort } from './dateUtils.js';
import { idsElegidos, nombreMiembro } from './miembrosAsignacion.js';
import { parseKm } from './kmUtils.js';

const CERRADOS = [TRABAJO_ESTADOS.FINALIZADO, TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO];

export const estaCerrado = (estado) => CERRADOS.includes(estado);

/**
 * Una ambulancia del alta: es una asignación (vehículo, responsables y
 * equipo). Las fechas en blanco son las del trabajo.
 */
export const ambulanciaVacia = () => ({
  vehicle_id: '', responsables: [''], personal: [],
  fecha_inicio: '', fecha_fin: '', km_inicio: '', notas: '',
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
    tipo:         trabajo?.tipo        || 'traslado',
    fecha_inicio: toInputDatetime(trabajo?.fecha_inicio) || '',
    fecha_fin:    toInputDatetime(trabajo?.fecha_fin)    || '',
    coordinador_user_id: trabajo?.coordinador_user_id || '',
    usuarios:     (trabajo?.usuarios || []).map(u => u.user_id),
    asignaciones: [],
  };
}

/** Errores del formulario, por campo. Vacío = se puede guardar. */
export function validarTrabajo(form, { alta = false } = {}) {
  const e = {};
  if (!form.nombre.trim())  e.nombre       = 'Nombre requerido';
  if (!form.fecha_inicio)   e.fecha_inicio = 'Fecha inicio requerida';
  if (!form.fecha_fin)      e.fecha_fin    = 'Fecha fin requerida';
  if (form.fecha_fin && form.fecha_inicio && form.fecha_fin <= form.fecha_inicio) {
    e.fecha_fin = 'Fecha fin debe ser posterior a fecha inicio';
  }
  if (form.ubicacion.length > 255) e.ubicacion = 'Máximo 255 caracteres';
  if (!idsElegidos([form.coordinador_user_id]).length) {
    e.coordinador_user_id = 'Elige quién coordina el trabajo';
  }
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
  }
  return e;
}

/**
 * Lo que se manda al backend: los datos, el coordinador y el equipo del
 * trabajo (`usuarios`); en el alta, además, sus ambulancias. Nunca
 * `vehiculos`: es el formato del modelo anterior y el backend daría 400.
 */
export function payloadTrabajo(form, { alta = false } = {}) {
  const datos = {
    nombre:       form.nombre.trim(),
    descripcion:  form.descripcion.trim() || null,
    ubicacion:    form.ubicacion.trim()   || null,
    tipo:         form.tipo,
    fecha_inicio: toUtcIso(form.fecha_inicio),
    fecha_fin:    toUtcIso(form.fecha_fin),
    coordinador_user_id: parseInt(form.coordinador_user_id, 10),
    usuarios:     idsElegidos(form.usuarios),
  };
  if (!alta) return datos;
  return {
    ...datos,
    asignaciones: form.asignaciones.map(a => ({
      vehicle_id:   parseInt(a.vehicle_id, 10),
      responsables: idsElegidos(a.responsables),
      personal:     idsElegidos(a.personal),
      // Sin fecha propia, el backend le pone la del trabajo
      ...(a.fecha_inicio ? { fecha_inicio: toUtcIso(a.fecha_inicio) } : {}),
      ...(a.fecha_fin    ? { fecha_fin:    toUtcIso(a.fecha_fin) }    : {}),
      km_inicio:    parseKm(a.km_inicio),
      notas:        a.notas.trim() || null,
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
      if (a.fin_servicio_at) return 'De vuelta a base';
      if (a.llegada_servicio_at) return 'En el evento/servicio';
      return 'En camino';
  }
}

/**
 * La gente ya asociada a un trabajo: su equipo, su coordinador y quien va en
 * alguna de sus ambulancias (las canceladas no cuentan). Es lo que sale
 * arriba, en «Asociados al trabajo», al elegir quién va en una ambulancia.
 */
function juntarAsociados(equipo, coordinador, ambulancias) {
  return new Set(idsElegidos([
    ...(equipo || []),
    coordinador,
    ...(ambulancias || []).flatMap(a => [...(a.responsables || []), ...(a.personal || [])]),
  ]));
}

/** Desde un trabajo cargado (ficha), al añadirle una ambulancia. */
export function asociadosDeTrabajo(trabajo) {
  if (!trabajo) return new Set();
  const ids = lista => (lista || []).map(m => m.id);
  return juntarAsociados(
    (trabajo.usuarios || []).map(u => u.user_id),
    trabajo.coordinador_user_id,
    (trabajo.asignaciones || [])
      .filter(a => a.estado !== 'cancelada')
      .map(a => ({ responsables: ids(a.responsables), personal: ids(a.personal) })),
  );
}

/** Desde el formulario de alta: lo que ya se ha rellenado en él. */
export function asociadosDeFormulario(form) {
  return juntarAsociados(form?.usuarios, form?.coordinador_user_id, form?.asignaciones);
}

/** Nombres de una lista de personas: «Ana Ruiz, Luis Gil». */
export function nombresDe(lista) {
  return (lista || []).map(nombreMiembro).filter(Boolean).join(', ');
}

/** Nombres de los responsables de una ambulancia (o de un vehículo v25). */
export function nombresResponsables(v) {
  return nombresDe(v?.responsables);
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
