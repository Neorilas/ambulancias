/**
 * utils/mantenimiento.utils.js
 *
 * Mantenimiento por kilómetros. La referencia es una sola columna,
 * `vehicles.km_proximo_mantenimiento` (v37): a cuántos km le toca el
 * siguiente. La mueven tres cosas:
 *   - Registrar una revisión de tipo `mantenimiento` (lo normal): el siguiente
 *     va a los km de esa revisión + el intervalo, o a lo que diga el taller
 *     («vuelva en 5.000») si se anota.
 *   - Editarla a mano en la ficha del vehículo.
 *   - Si está vacía, la primera lectura de km > 0 la fija al siguiente
 *     múltiplo de 15.000 (`SQL_FIJAR_PROXIMO_MANTENIMIENTO`). Mismo cálculo que
 *     hizo v37 con los vehículos que ya tenían km.
 */

'use strict';

const { MANTENIMIENTO_INTERVALO_KM } = require('../config/constants');

/**
 * Siguiente múltiplo del intervalo estrictamente por encima de `km`:
 * 32.000 → 45.000; 45.000 → 60.000. Sin km (null, 0) no hay referencia: un 0
 * suele ser «no se ha anotado», y fijar 15.000 a una ambulancia con 230.000
 * reales daría un aviso de «pasado hace 215.000 km» en cuanto se corrigiera.
 */
function siguienteMultiplo(km) {
  const n = Number(km);
  if (!Number.isFinite(n) || n <= 0) return null;
  return (Math.floor(n / MANTENIMIENTO_INTERVALO_KM) + 1) * MANTENIMIENTO_INTERVALO_KM;
}

/**
 * Fragmento de `SET` que fija la referencia si está vacía, con los km que
 * acaba de escribir el MISMO `UPDATE`. Tiene que ir DESPUÉS de
 * `kilometros_actuales = ?`: en un UPDATE de una sola tabla MySQL evalúa las
 * asignaciones de izquierda a derecha y cada una ve el valor ya cambiado de
 * las anteriores. Así no hay que pasar el km dos veces ni leer antes.
 */
const SQL_FIJAR_PROXIMO_MANTENIMIENTO =
  `km_proximo_mantenimiento = COALESCE(km_proximo_mantenimiento,
     IF(kilometros_actuales > 0,
        (FLOOR(kilometros_actuales / ${MANTENIMIENTO_INTERVALO_KM}) + 1) * ${MANTENIMIENTO_INTERVALO_KM},
        NULL))`;

module.exports = { siguienteMultiplo, SQL_FIJAR_PROXIMO_MANTENIMIENTO };
