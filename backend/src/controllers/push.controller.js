/**
 * controllers/push.controller.js
 * Alta, baja y prueba de los avisos Web Push de un dispositivo.
 *
 * El flujo completo, visto desde el navegador del administrador:
 *   1. GET  /push/vapid-public-key → la clave con la que suscribirse.
 *   2. El navegador pide permiso al usuario y crea la PushSubscription.
 *   3. POST /push/subscribe → se guarda para poder empujarle avisos.
 *   4. POST /push/test → comprobación de que de verdad suena en ese teléfono.
 *   5. DELETE /push/subscribe → baja al desactivar los avisos.
 */

'use strict';

const { success, error } = require('../utils/response.utils');
const push               = require('../services/push.service');
const logger             = require('../utils/logger.utils');

// ============================================================
// GET /push/vapid-public-key
// ============================================================
// Sin claves configuradas se responde 200 con `configurado: false` y no 503:
// el frontend necesita distinguir «este entorno no tiene push» (y explicarlo)
// de «la petición ha fallado» (y reintentar).
async function getClavePublica(_req, res, next) {
  try {
    return success(res, {
      configurado: push.estaConfigurado(),
      publicKey:   push.clavePublica(),
    });
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /push/subscribe
// ============================================================
async function subscribe(req, res, next) {
  try {
    const { subscription } = req.body;
    if (!subscription || typeof subscription !== 'object') {
      return error(res, 'Falta la suscripción del navegador', 400);
    }

    await push.guardarSuscripcion({
      userId:       req.user.id,
      subscription,
      userAgent:    req.headers['user-agent'],
    });

    logger.info(`Push: alta de dispositivo para ${req.user.username} (id ${req.user.id})`);
    return success(res, { suscrito: true }, 'Avisos activados en este dispositivo');
  } catch (err) {
    // Una suscripción mal formada es culpa del cliente, no del servidor.
    if (/Suscripción incompleta/.test(err.message)) {
      return error(res, err.message, 400);
    }
    next(err);
  }
}

// ============================================================
// DELETE /push/subscribe
// ============================================================
// Se borra por endpoint + usuario: nadie puede dar de baja el teléfono de otro
// mandando su endpoint.
async function unsubscribe(req, res, next) {
  try {
    const endpoint = req.body?.endpoint;
    if (!endpoint) return error(res, 'Falta el endpoint de la suscripción', 400);

    const borrada = await push.borrarSuscripcion({ userId: req.user.id, endpoint });
    return success(res, { borrada }, borrada
      ? 'Avisos desactivados en este dispositivo'
      : 'Este dispositivo no tenía los avisos activados');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /push/estado
// ============================================================
// Responde si ESTE navegador (por su endpoint) está dado de alta. El frontend
// no puede deducirlo solo: el navegador puede conservar una PushSubscription
// que el servidor ya borró por caducada.
async function estado(req, res, next) {
  try {
    const endpoint = req.query?.endpoint;
    const registrado = endpoint
      ? await push.tieneSuscripcion({ userId: req.user.id, endpoint })
      : false;
    return success(res, {
      configurado: push.estaConfigurado(),
      registrado,
    });
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /push/test
// ============================================================
async function test(req, res, next) {
  try {
    if (!push.estaConfigurado()) {
      return error(res, 'Los avisos push no están configurados en este entorno', 503);
    }

    const resumen = await push.notificarUsuario(req.user.id, {
      titulo: 'Aviso de prueba',
      cuerpo: 'Si has oído esto, los avisos funcionan en este dispositivo.',
      url:    '/mis-asignaciones',
      // Tag FIJO, no uno por envío. Con un tag distinto cada vez las pruebas se
      // apilan en la bandeja y Android deja de alertar de las siguientes del
      // montón; con el mismo tag (y `renotify` en el service worker) la nueva
      // sustituye a la anterior y vuelve a sonar, que es lo que se espera de un
      // botón que existe justo para comprobar si suena.
      tag:    `test-${req.user.id}`,
    });

    if (resumen.omitido === 'sin-suscripciones') {
      return error(res, 'No hay ningún dispositivo dado de alta para tu usuario', 400);
    }
    if (resumen.enviados === 0) {
      return error(res, 'No se pudo entregar el aviso de prueba. Vuelve a activar los avisos en este dispositivo.', 502);
    }

    return success(res, resumen, `Aviso enviado a ${resumen.enviados} dispositivo(s)`);
  } catch (err) {
    next(err);
  }
}

module.exports = { getClavePublica, subscribe, unsubscribe, estado, test };
