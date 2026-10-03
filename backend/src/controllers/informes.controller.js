/**
 * controllers/informes.controller.js
 * Informe mensual para administración (services/informes.service.js).
 */

'use strict';

const { success, error } = require('../utils/response.utils');
const informes = require('../services/informes.service');
const { ahora } = require('../utils/fecha.utils');
const logger = require('../utils/logger.utils');
const { registrarErrorServidor } = require('../middleware/error.middleware');

/**
 * GET /informes/mensual?mes=YYYY-MM
 * El mes pedido (por defecto el en curso) y, para comparar, el anterior y el
 * mismo mes del año pasado. De los dos de comparación solo va el resumen: las
 * tablas por vehículo y por técnico son del mes pedido.
 */
async function getInformeMensual(req, res) {
  const instante = ahora();
  const mes = req.query.mes ? String(req.query.mes) : informes.mesDe(instante);
  if (!informes.esMes(mes)) return error(res, 'Mes no válido: se espera YYYY-MM', 400);
  if (mes > informes.mesDe(instante)) return error(res, 'Ese mes todavía no ha empezado', 400);

  try {
    const [actual, anterior, anioAnterior] = await Promise.all([
      informes.obtenerInforme(mes, instante),
      informes.obtenerInforme(informes.mesDesplazado(mes, -1), instante),
      informes.obtenerInforme(informes.mesDesplazado(mes, -12), instante),
    ]);
    const soloResumen = (inf) => (inf ? {
      mes: inf.mes, fuente: inf.fuente, en_curso: Boolean(inf.en_curso), resumen: inf.resumen,
    } : null);

    return success(res, {
      actual,
      comparativa: { anterior: soloResumen(anterior), anio_anterior: soloResumen(anioAnterior) },
    });
  } catch (err) {
    logger.error(`Informes: error calculando ${mes}: ${err.message}`);
    registrarErrorServidor(req, err);
    return error(res, 'No se pudo calcular el informe');
  }
}

module.exports = { getInformeMensual };
