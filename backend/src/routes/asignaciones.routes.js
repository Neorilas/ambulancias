/**
 * routes/asignaciones.routes.js
 * Asignaciones libres de vehículo (independientes de trabajos)
 */

'use strict';

const express = require('express');
const { body, param } = require('express-validator');
const ctrl = require('../controllers/asignaciones.controller');
const { authenticate }          = require('../middleware/auth.middleware');
const { requirePermission }     = require('../middleware/roles.middleware');
const { handleValidation }      = require('../middleware/validate.middleware');
const { multerUpload, processAndSave } = require('../middleware/upload.middleware');
const { uploadLimiter }         = require('../middleware/rateLimiter.middleware');
const { IMAGEN_TIPOS, PERMISSIONS } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

// GET /asignaciones  (todos autenticados; admin/gestor ven todas, operacionales solo las suyas)
router.get('/', ctrl.listAsignaciones);

// GET /asignaciones/:id
router.get('/:id',
  [param('id').isInt({ min: 1 })],
  handleValidation,
  ctrl.getAsignacion
);

// POST /asignaciones  (admin/gestor)
router.post('/',
  requirePermission(PERMISSIONS.MANAGE_TRABAJOS),
  [
    body('vehicle_id').notEmpty().isInt({ min: 1 }).withMessage('vehicle_id requerido'),
    body('user_id').notEmpty().isInt({ min: 1 }).withMessage('user_id requerido'),
    body('fecha_inicio').notEmpty().isISO8601().withMessage('fecha_inicio inválida'),
    body('fecha_fin').notEmpty().isISO8601().withMessage('fecha_fin inválida'),
    body('km_inicio').optional({ nullable: true }).isInt({ min: 0 }),
    body('notas').optional({ nullable: true }).isString().isLength({ max: 1000 }),
  ],
  handleValidation,
  ctrl.createAsignacion
);

// PUT /asignaciones/:id  (admin/gestor)
router.put('/:id',
  requirePermission(PERMISSIONS.MANAGE_TRABAJOS),
  [
    param('id').isInt({ min: 1 }),
    body('vehicle_id').optional().isInt({ min: 1 }),
    body('user_id').optional().isInt({ min: 1 }),
    body('fecha_inicio').optional().isISO8601(),
    body('fecha_fin').optional().isISO8601(),
    body('km_inicio').optional({ nullable: true }).isInt({ min: 0 }),
    body('notas').optional({ nullable: true }).isString().isLength({ max: 1000 }),
    body('estado').optional().isIn(['programada', 'activa', 'cancelada']),
  ],
  handleValidation,
  ctrl.updateAsignacion
);

// DELETE /asignaciones/:id  (admin/gestor)
router.delete('/:id',
  requirePermission(PERMISSIONS.MANAGE_TRABAJOS),
  [param('id').isInt({ min: 1 })],
  handleValidation,
  ctrl.deleteAsignacion
);

// POST /asignaciones/:id/activar
router.post('/:id/activar',
  [param('id').isInt({ min: 1 })],
  handleValidation,
  ctrl.activarAsignacion
);

// POST /asignaciones/:id/finalizar
router.post('/:id/finalizar',
  [
    param('id').isInt({ min: 1 }),
    body('km_fin').optional({ nullable: true }).isInt({ min: 0 }),
    body('motivo_fin').optional({ nullable: true }).isString().isLength({ max: 2000 }),
  ],
  handleValidation,
  ctrl.finalizarAsignacion
);

// POST /asignaciones/:id/evidencias  (multer → processAndSave → controller)
router.post('/:id/evidencias',
  uploadLimiter,
  multerUpload.single('image'),
  [
    param('id').isInt({ min: 1 }),
    body('tipo_imagen').notEmpty().isIn(IMAGEN_TIPOS)
      .withMessage(`tipo_imagen debe ser: ${IMAGEN_TIPOS.join(', ')}`),
    body('momento').optional().isIn(['inicio', 'fin'])
      .withMessage('momento debe ser "inicio" o "fin"'),
  ],
  handleValidation,
  async (req, res, next) => {
    return processAndSave(`asignaciones/${req.params.id}`)(req, res, next);
  },
  ctrl.uploadEvidencia
);

module.exports = router;
