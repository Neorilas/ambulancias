/**
 * utils/trabajos.js
 * Trabajos multi-vehículo (v25): el formulario y qué puede hacer cada uno con
 * cada vehículo.
 *
 * Quién ve y quién hace qué lo decide el BACKEND (`vistaParaUsuario` en
 * trabajos.controller): cada vehículo llega con `soy_responsable` y `detalle`,
 * y el trabajo con `mi_rol`. Aquí solo se traduce eso a botones, para no
 * ofrecer lo que luego se rechazaría.
 */

import { TRABAJO_ESTADOS } from './constants.js';
import { toInputDatetime, toUtcIso } from './dateUtils.js';
import { idsElegidos } from './miembrosAsignacion.js';
import { parseKm } from './kmUtils.js';

const CERRADOS = [TRABAJO_ESTADOS.FINALIZADO, TRABAJO_ESTADOS.FINALIZADO_ANTICIPADO];

export const estaCerrado = (estado) => CERRADOS.includes(estado);

/** Estado inicial del formulario a partir de un trabajo completo (o ninguno). */
export function formularioInicial(trabajo) {
  return {
    nombre:       trabajo?.nombre      || '',
    descripcion:  trabajo?.descripcion || '',
    ubicacion:    trabajo?.ubicacion   || '',
    tipo:         trabajo?.tipo        || 'traslado',
    fecha_inicio: toInputDatetime(trabajo?.fecha_inicio) || '',
    fecha_fin:    toInputDatetime(trabajo?.fecha_fin)    || '',
    vehiculos: (trabajo?.vehiculos || []).map(v => {
      const responsables = (v.responsables || []).map(r => r.id);
      return {
        vehicle_id:        v.vehicle_id,
        // Una fila anterior a v25 sin responsables cargados: su principal
        responsables:      responsables.length ? responsables : [v.responsable_user_id || ''],
        kilometros_inicio: v.kilometros_inicio ?? '',
        // Un vehículo que ya arrancó no se puede quitar (lo corta el backend)
        bloqueado:         !!v.estado && v.estado !== TRABAJO_ESTADOS.PROGRAMADO,
      };
    }),
    usuarios: (trabajo?.usuarios || []).map(u => u.user_id),
  };
}

/** Fila vacía para «Añadir vehículo». */
export const vehiculoVacio = () =>
  ({ vehicle_id: '', responsables: [''], kilometros_inicio: '', bloqueado: false });

/** Errores del formulario, por campo. Vacío = se puede guardar. */
export function validarTrabajo(form) {
  const e = {};
  if (!form.nombre.trim())  e.nombre       = 'Nombre requerido';
  if (!form.fecha_inicio)   e.fecha_inicio = 'Fecha inicio requerida';
  if (!form.fecha_fin)      e.fecha_fin    = 'Fecha fin requerida';
  if (form.fecha_fin && form.fecha_inicio && form.fecha_fin <= form.fecha_inicio) {
    e.fecha_fin = 'Fecha fin debe ser posterior a fecha inicio';
  }
  if (form.ubicacion.length > 255) e.ubicacion = 'Máximo 255 caracteres';

  const ids = form.vehiculos.map(v => parseInt(v.vehicle_id, 10));
  if (form.vehiculos.some((v, i) => !ids[i] || !idsElegidos(v.responsables).length)) {
    e.vehiculos = 'Cada vehículo necesita el vehículo y al menos un responsable';
  } else if (new Set(ids).size !== ids.length) {
    e.vehiculos = 'El mismo vehículo está dos veces';
  }
  return e;
}

/** Lo que se manda al backend. */
export function payloadTrabajo(form) {
  return {
    nombre:       form.nombre.trim(),
    descripcion:  form.descripcion.trim() || null,
    ubicacion:    form.ubicacion.trim()   || null,
    tipo:         form.tipo,
    fecha_inicio: toUtcIso(form.fecha_inicio),
    fecha_fin:    toUtcIso(form.fecha_fin),
    vehiculos: form.vehiculos.map(v => ({
      vehicle_id:        parseInt(v.vehicle_id, 10),
      responsables:      idsElegidos(v.responsables),
      kilometros_inicio: parseKm(v.kilometros_inicio),
    })),
    usuarios: idsElegidos(form.usuarios),
  };
}

/**
 * Qué toca hacer con UN vehículo del trabajo, desde el punto de vista de quien
 * mira. Solo hay acciones en los vehículos con `detalle` (gestión o
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

/** Vehículos en los que quien mira tiene algo pendiente. */
export function vehiculosConAcciones(trabajo) {
  return (trabajo?.vehiculos || []).filter(v => {
    const a = accionesVehiculo(v);
    return a.activar || a.fotosInicio || a.finalizar;
  });
}

/** Nombres de los responsables de un vehículo: «Ana Ruiz, Luis Gil». */
export function nombresResponsables(v) {
  return (v?.responsables || [])
    .map(r => [r.nombre, r.apellidos].filter(Boolean).join(' ') || r.username)
    .join(', ');
}
