/**
 * routes/push.routes.js
 * Avisos Web Push: alta y baja del dispositivo.
 *
 * Abierto a cualquier autenticado (hasta 2026-09-25 exigía MANAGE_TRABAJOS):
 * los técnicos también reciben avisos — el de «te han asignado un servicio».
 * Suscribirse no da acceso a nada: QUÉ avisos le llegan a cada uno lo decide
 * push.service al enviar (admins por permiso, miembros por asignación). Cada
 * endpoint solo actúa sobre las suscripciones del propio usuario.
 */

'use strict';

const express = require('express');
const { body, query: q } = require('express-validator');

const ctrl                  = require('../controllers/push.controller');
const { authenticate }      = require('../middleware/auth.middleware');
const { handleValidation }  = require('../middleware/validate.middleware');
const { pushLimiter }       = require('../middleware/rateLimiter.middleware');

const router = express.Router();

router.use(authenticate);

// GET /push/vapid-public-key
router.get('/vapid-public-key', ctrl.getClavePublica);

// GET /push/estado?endpoint=...
router.get('/estado',
  [q('endpoint').optional().isString().isLength({ max: 512 })],
  handleValidation,
  ctrl.estado
);

// POST /push/subscribe
router.post('/subscribe',
  pushLimiter,
  [
    body('subscription').isObject().withMessage('subscription requerida'),
    body('subscription.endpoint').isString().isLength({ min: 1, max: 512 })
      .withMessage('endpoint inválido'),
    body('subscription.keys.p256dh').isString().isLength({ min: 1, max: 255 }),
    body('subscription.keys.auth').isString().isLength({ min: 1, max: 255 }),
  ],
  handleValidation,
  ctrl.subscribe
);

// DELETE /push/subscribe
router.delete('/subscribe',
  pushLimiter,
  [body('endpoint').isString().isLength({ min: 1, max: 512 })],
  handleValidation,
  ctrl.unsubscribe
);

// POST /push/test  — aviso de prueba a uno mismo
router.post('/test', pushLimiter, ctrl.test);

module.exports = router;
