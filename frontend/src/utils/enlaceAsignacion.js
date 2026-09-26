/**
 * utils/enlaceAsignacion.js
 * Cómo se nombra una asignación y a dónde lleva cuando se cita desde otra
 * pantalla: la ficha del vehículo, el mapa de flota, la alarma de «sin iniciar».
 *
 * Una asignación no tiene título propio en BD: se nombra por su número, que es
 * como se llama a sí misma en su detalle («Detalle de asignación #N»).
 *
 * El detalle no es una página sino un panel de `AsignacionList`, así que la
 * ruta es el listado con `?id=`, que lo abre directamente.
 */

export function tituloAsignacion(asignacion) {
  return `Asignación #${asignacion.id}`;
}

export function rutaAsignacion(id) {
  return `/asignaciones?id=${id}`;
}
