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

/**
 * GET /informes/tecnico/:userId?mes=YYYY-MM
 * Los servicios de un técnico en el mes, con sus horas y lo que no cuadra
 * (services/informes.service.js → `detalleTecnico`). Es lo que se abre al
 * pulsar un técnico en «Por técnico» y lo que va al PDF.
 */
async function getDetalleTecnico(req, res) {
  const instante = ahora();
  const mes = req.query.mes ? String(req.query.mes) : informes.mesDe(instante);
  if (!informes.esMes(mes)) return error(res, 'Mes no válido: se espera YYYY-MM', 400);
  if (mes > informes.mesDe(instante)) return error(res, 'Ese mes todavía no ha empezado', 400);
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId < 1) return error(res, 'Usuario no válido', 400);

  try {
    const detalle = await informes.detalleTecnico(mes, userId, req.user.id, instante);
    if (!detalle) return error(res, 'Usuario no encontrado', 404);
    return success(res, detalle);
  } catch (err) {
    logger.error(`Informes: error en el detalle del usuario ${userId} de ${mes}: ${err.message}`);
    registrarErrorServidor(req, err);
    return error(res, 'No se pudo calcular el detalle');
  }
}

module.exports = { getInformeMensual, getDetalleTecnico };
