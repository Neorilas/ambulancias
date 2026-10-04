'use strict';

/**
 * Purga de `error_logs`. Sin ella la tabla solo crece: los errores de la app
 * (origen `cliente`) los puede mandar cualquier cuenta, y la tabla entra
 * entera en cada dump diario que va a Google Drive.
 *
 * Los de la app duran menos que los del servidor: sirven para diagnosticar
 * el fallo de esta semana; un 5xx del servidor puede hacer falta meses
 * después para entender un incidente.
 *
 * Borra por tandas para no bloquear la tabla en una sola sentencia larga.
 * No lanza nunca: un fallo se queda en el log y la siguiente pasada lo
 * vuelve a intentar.
 */

const { query }  = require('../config/database');
const { haceHoras } = require('../utils/fecha.utils');
const logger     = require('../utils/logger.utils');

const DIAS_CLIENTE  = 30;
const DIAS_SERVIDOR = 180;
const TANDA         = 5000;
const TANDAS_MAX    = 100; // tope por pasada: 500 000 filas

async function purgarOrigen(origen, dias, ahora) {
  const corte = haceHoras(dias * 24, ahora);
  let total = 0;
  for (let i = 0; i < TANDAS_MAX; i++) {
    const [r] = await query(
      `DELETE FROM error_logs WHERE origen = ? AND created_at < ? LIMIT ${TANDA}`,
      [origen, corte]
    );
    total += r.affectedRows;
    if (r.affectedRows < TANDA) break;
  }
  return total;
}

async function purgarErroresAntiguos(ahora = new Date()) {
  try {
    const cliente  = await purgarOrigen('cliente',  DIAS_CLIENTE,  ahora);
    const servidor = await purgarOrigen('servidor', DIAS_SERVIDOR, ahora);
    if (cliente || servidor) {
      logger.info(`Limpieza de error_logs: ${cliente} de la app (>${DIAS_CLIENTE} días) y ${servidor} del servidor (>${DIAS_SERVIDOR} días)`);
    }
    return { cliente, servidor };
  } catch (err) {
    logger.error('Error en la limpieza de error_logs:', err.message);
    return { cliente: 0, servidor: 0, error: err.message };
  }
}

module.exports = { purgarErroresAntiguos, DIAS_CLIENTE, DIAS_SERVIDOR, TANDA };
