/**
 * utils/enlaceAsignacion.js
 * Cómo se nombra una asignación y a dónde lleva cuando se cita desde otra
 * pantalla: la ficha del vehículo, el mapa de flota, la alarma de «sin iniciar».
 *
 * Desde v33 una asignación es una ambulancia DENTRO de un trabajo, y el enlace
 * lleva al trabajo con esa ambulancia señalada (decisión 8 del plan del
 * trabajo padre): es la unidad principal de información. Solo si la pantalla
 * de trabajos está abierta para quien mira (`trabajosVisibles`); si no —o si
 * la asignación es del modelo antiguo, sin trabajo—, al listado con `?id=`,
 * que abre su detalle. Así el enlace nunca rebota mientras Trabajos esté
 * apagado.
 *
 * Una asignación no tiene título propio en BD: se nombra por su número, que es
 * como se llama a sí misma en su detalle («Detalle de asignación #N»), o por su
 * trabajo cuando es ahí adonde lleva.
 */

/** `asignacion` puede ser la fila (con `trabajo_id`) o solo su id. */
function normalizar(asignacion) {
  return typeof asignacion === 'object' && asignacion !== null ? asignacion : { id: asignacion };
}

const vaAlTrabajo = (a, trabajosVisibles) => !!a.trabajo_id && !!trabajosVisibles;

export function tituloAsignacion(asignacion, trabajosVisibles = false) {
  const a = normalizar(asignacion);
  return vaAlTrabajo(a, trabajosVisibles) && a.trabajo_nombre
    ? `Trabajo «${a.trabajo_nombre}»`
    : `Asignación #${a.id}`;
}

export function rutaAsignacion(asignacion, trabajosVisibles = false) {
  const a = normalizar(asignacion);
  return vaAlTrabajo(a, trabajosVisibles)
    ? `/trabajos/${a.trabajo_id}?asignacion=${a.id}`
    : `/asignaciones?id=${a.id}`;
}

/** ¿Lleva al trabajo? Quien enlaza lo necesita para saber qué flag mirar. */
export function enlazaAlTrabajo(asignacion, trabajosVisibles = false) {
  return vaAlTrabajo(normalizar(asignacion), trabajosVisibles);
}
