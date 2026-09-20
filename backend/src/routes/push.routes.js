/**
 * routes/push.routes.js
 * Avisos Web Push: alta y baja del dispositivo del administrador.
 *
 * Todo cuelga de MANAGE_TRABAJOS porque solo se avisa a quien gestiona la
 * flota. La clave pública también: no es un secreto, pero publicarla a
 * cualquier autenticado invitaría a que un técnico intentase suscribirse y se
 * comiera un 403 más adelante, sin entender por qué.
 */

'use strict';

const express = require('express');
const { body, query: q } = require('express-validator');

const ctrl                  = require('../controllers/push.controller');
const { authenticate }      = require('../middleware/auth.middleware');
const { requirePermission } = require('../middleware/roles.middleware');
const { handleValidation }  = require('../middleware/validate.middleware');
const { pushLimiter }       = require('../middleware/rateLimiter.middleware');
const { PERMISSIONS }       = require('../config/constants');

const router = express.Router();

router.use(authenticate);
router.use(requirePermission(PERMISSIONS.MANAGE_TRABAJOS));

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
