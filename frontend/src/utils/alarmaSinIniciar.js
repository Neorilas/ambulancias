/**
 * utils/alarmaSinIniciar.js
 * Qué alarmas de «servicio sin iniciar» tienen que sonar en ESTE dispositivo.
 *
 * El backend (`GET /asignaciones/alarmas`) devuelve las asignaciones que ya se
 * avisaron por push y siguen sin iniciarse. La alarma suena mientras haya
 * alguna que este dispositivo no haya dado por «Enterado». El «Enterado» es
 * POR DISPOSITIVO a propósito: que un administrador la haya visto no quiere
 * decir que el resto se haya enterado, y la alarma se apaga sola para todos
 * en cuanto el técnico pulsa «Inicio de servicio».
 *
 * La clave de cada alarma lleva la hora del aviso (`aviso_sin_iniciar_at`),
 * no solo el id: si la asignación se aplaza, el backend limpia la marca, y
 * cuando vuelva a vencer es una alarma nueva que tiene que volver a sonar
 * aunque la anterior se diera por vista.
 */

import { getItem, setItem } from './sessionStorage.js';

export const CLAVE_ATENDIDAS = 'alarmasSinIniciarAtendidas';

/** Identidad de una alarma: asignación + momento en que se avisó. */
export function claveAlarma(alarma) {
  return `${alarma.id}@${alarma.aviso_sin_iniciar_at ?? ''}`;
}

/**
 * Tag de la notificación push de esta alarma. Tiene que coincidir con el que
 * pone el backend (`avisosAsignacion.avisarAsignacionSinIniciar`): con él,
 * «Enterado» quita de la bandeja la notificación del sistema.
 */
export function tagAviso(alarma) {
  return `asig-${alarma.id}-sin-iniciar`;
}

/** Claves ya atendidas en este dispositivo. Un valor corrupto vale por vacío. */
export function leerAtendidas() {
  try {
    const lista = JSON.parse(getItem(CLAVE_ATENDIDAS) || '[]');
    return new Set(Array.isArray(lista) ? lista.filter(k => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * Marca como atendidas las alarmas dadas y olvida las que ya no están en la
 * lista del servidor (iniciadas, cerradas): así lo guardado no crece sin fin.
 */
export function marcarAtendidas(alarmasAtendidas, alarmasVigentes) {
  const vigentes = new Set((alarmasVigentes || []).map(claveAlarma));
  const atendidas = [...leerAtendidas(), ...(alarmasAtendidas || []).map(claveAlarma)]
    .filter(k => vigentes.has(k));
  setItem(CLAVE_ATENDIDAS, JSON.stringify([...new Set(atendidas)]));
}

/** Las alarmas que tienen que sonar: las vigentes que aquí nadie ha atendido. */
export function alarmasPendientes(alarmas, atendidas = leerAtendidas()) {
  return (alarmas || []).filter(a => !atendidas.has(claveAlarma(a)));
}

/** Cómo se nombra la ambulancia: el alias manda, la matrícula es el respaldo. */
export function etiquetaVehiculo(alarma) {
  return alarma?.vehiculo_alias || alarma?.matricula || 'Vehículo sin identificar';
}

/** Responsables tal y como se pintan en el resto de la app. */
export function etiquetaResponsables(alarma) {
  return alarma?.responsables_nombres || alarma?.responsable_nombre || 'Sin responsable';
}

/** Minutos enteros de retraso sobre la hora prevista (nunca negativos). */
export function minutosDeRetraso(fechaInicio, ahora = new Date()) {
  const inicio = new Date(fechaInicio).getTime();
  if (!Number.isFinite(inicio)) return 0;
  return Math.max(0, Math.floor((ahora.getTime() - inicio) / 60000));
}
