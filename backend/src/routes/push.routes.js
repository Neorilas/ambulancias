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
const { forbidden }         = require('../utils/response.utils');

const router = express.Router();

router.use(authenticate);

// Impersonando no se tocan los avisos: el navegador es el del superadmin y
// darlo de alta aquí lo apuntaría a nombre del otro usuario (le llegarían al
// superadmin los avisos de ese técnico, y a ese técnico se le «movería» el
// dispositivo). Decisión del 2026-09-26: push fuera de la impersonación.
router.use((req, res, next) => (
  req.user.impersonadoPor
    ? forbidden(res, 'Los avisos push no se gestionan mientras ves la app como otro usuario')
    : next()
));

// GET /push/vapid-public-key
router.get('/vapid-public-key', ctrl.getClavePublica);

// POST /push/estado  { endpoint }
router.post('/estado',
  [body('endpoint').optional().isString().isLength({ max: 512 })],
  handleValidation,
  ctrl.estado
);

// GET /push/estado?endpoint=...  — OBSOLETO: lo siguen usando las PWAs que aún
// no se han actualizado. Retirar cuando todas lleven el POST (el endpoint en la
// query string acaba en el log de peticiones).
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
