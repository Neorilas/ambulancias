/**
 * routes/trabajos.routes.js
 */

'use strict';

const express = require('express');
const { body, param, query: qv } = require('express-validator');
const ctrl    = require('../controllers/trabajos.controller');
const { authenticate }             = require('../middleware/auth.middleware');
const { requireAdminOrGestor }     = require('../middleware/roles.middleware');
const { handleValidation }         = require('../middleware/validate.middleware');
const { multerUpload, processAndSave } = require('../middleware/upload.middleware');
const { uploadLimiter }            = require('../middleware/rateLimiter.middleware');
const { TRABAJO_TIPOS, IMAGEN_TIPOS_REQUERIDOS } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

// GET /trabajos/mis-trabajos  (para personal operacional)
router.get('/mis-trabajos', ctrl.misTrab);

// GET /trabajos/calendario
router.get('/calendario',
  [
    qv('year').optional().isInt({ min: 2020, max: 2100 }),
    qv('month').optional().isInt({ min: 1, max: 12 }),
  ],
  handleValidation,
  ctrl.listTrabajosCalendario
);

// GET /trabajos
router.get('/', ctrl.listTrabajos);

// GET /trabajos/:id
router.get('/:id',
  [param('id').isInt({ min: 1 })],
  handleValidation,
  ctrl.getTrabajo
);

// POST /trabajos  (admin o gestor)
router.post('/',
  requireAdminOrGestor,
  [
    body('nombre').trim().notEmpty().withMessage('Nombre requerido').isLength({ max: 255 }),
    body('tipo').notEmpty().isIn(Object.values(TRABAJO_TIPOS)).withMessage(`tipo inválido. Valores válidos: ${Object.values(TRABAJO_TIPOS).join(', ')}`),
    body('fecha_inicio').notEmpty().isISO8601().withMessage('fecha_inicio inválida'),
    body('fecha_fin').notEmpty().isISO8601().withMessage('fecha_fin inválida'),
    body('vehiculos').optional().isArray(),
    body('vehiculos.*.vehicle_id').optional().isInt({ min: 1 }),
    body('vehiculos.*.responsable_user_id').optional().isInt({ min: 1 }),
    body('usuarios').optional().isArray(),
  ],
  handleValidation,
  ctrl.createTrabajo
);

// PUT /trabajos/:id  (admin o gestor)
router.put('/:id',
  requireAdminOrGestor,
  [param('id').isInt({ min: 1 })],
  handleValidation,
  ctrl.updateTrabajo
);

// DELETE /trabajos/:id  (admin o gestor)
router.delete('/:id',
  requireAdminOrGestor,
  [param('id').isInt({ min: 1 })],
  handleValidation,
  ctrl.deleteTrabajo
);

// POST /trabajos/:id/finalize  - finalizar trabajo con evidencias
router.post('/:id/finalize',
  [
    param('id').isInt({ min: 1 }),
    body('motivo_finalizacion_anticipada').optional().isString(),
    body('vehiculos_km').optional().isArray(),
    body('vehiculos_km.*.vehicle_id').optional().isInt({ min: 1 }),
    body('vehiculos_km.*.kilometros_fin').optional().isInt({ min: 0 }),
  ],
  handleValidation,
  ctrl.finalizeTrabajo
);

// POST /trabajos/:id/evidencias  - subir evidencia fotográfica
router.post('/:id/evidencias',
  uploadLimiter,
  [
    param('id').isInt({ min: 1 }),
    body('vehicle_id').notEmpty().isInt({ min: 1 }).withMessage('vehicle_id requerido'),
    body('tipo_imagen').notEmpty().isIn(IMAGEN_TIPOS_REQUERIDOS)
      .withMessage(`tipo_imagen debe ser: ${IMAGEN_TIPOS_REQUERIDOS.join(', ')}`),
  ],
  handleValidation,
  multerUpload.single('image'),
  async (req, res, next) => {
    const { processAndSave } = require('../middleware/upload.middleware');
    return processAndSave(`trabajos/${req.params.id}`)(req, res, next);
  },
  ctrl.uploadEvidencia
);

module.exports = router;
