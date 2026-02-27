/**
 * routes/vehicles.routes.js
 */

'use strict';

const express = require('express');
const { body, param } = require('express-validator');
const ctrl    = require('../controllers/vehicles.controller');
const { authenticate }          = require('../middleware/auth.middleware');
const { requireAdminOrGestor, requireAdmin } = require('../middleware/roles.middleware');
const { handleValidation }      = require('../middleware/validate.middleware');
const { multerUpload }          = require('../middleware/upload.middleware');
const { uploadLimiter }         = require('../middleware/rateLimiter.middleware');
const { IMAGEN_TIPOS }          = require('../config/constants');

const router = express.Router();
router.use(authenticate);

// GET /vehicles
router.get('/', ctrl.listVehicles);

// GET /vehicles/:id
router.get('/:id',
  [param('id').isInt({ min: 1 })],
  handleValidation,
  ctrl.getVehicle
);

// GET /vehicles/:id/images
router.get('/:id/images',
  [param('id').isInt({ min: 1 })],
  handleValidation,
  ctrl.getVehicleImages
);

// POST /vehicles  (admin o gestor)
router.post('/',
  requireAdminOrGestor,
  [
    body('matricula').trim().notEmpty().withMessage('Matrícula requerida')
      .isLength({ max: 20 }).withMessage('Matrícula demasiado larga'),
    body('alias').trim().notEmpty().withMessage('Alias requerido')
      .isLength({ max: 100 }),
    body('kilometros_actuales').optional().isInt({ min: 0 }).withMessage('Kilómetros inválidos'),
    body('fecha_ultima_revision').optional({ nullable: true }).isISO8601().withMessage('Fecha inválida'),
    body('fecha_ultimo_servicio').optional({ nullable: true }).isISO8601().withMessage('Fecha inválida'),
  ],
  handleValidation,
  ctrl.createVehicle
);

// PUT /vehicles/:id  (admin o gestor)
router.put('/:id',
  requireAdminOrGestor,
  [
    param('id').isInt({ min: 1 }),
    body('kilometros_actuales').optional().isInt({ min: 0 }),
    body('fecha_ultima_revision').optional({ nullable: true }).isISO8601(),
    body('fecha_ultimo_servicio').optional({ nullable: true }).isISO8601(),
  ],
  handleValidation,
  ctrl.updateVehicle
);

// DELETE /vehicles/:id  (solo admin)
router.delete('/:id',
  requireAdmin,
  [param('id').isInt({ min: 1 })],
  handleValidation,
  ctrl.deleteVehicle
);

// POST /vehicles/:id/images  - subir imagen (middleware dinámico para subdir)
router.post('/:id/images',
  uploadLimiter,
  [
    param('id').isInt({ min: 1 }),
    body('tipo_imagen').notEmpty().isIn(IMAGEN_TIPOS)
      .withMessage(`tipo_imagen debe ser uno de: ${IMAGEN_TIPOS.join(', ')}`),
  ],
  handleValidation,
  multerUpload.single('image'),
  // processAndSave necesita el id del vehículo → lo inyectamos como middleware inline
  async (req, res, next) => {
    const { processAndSave } = require('../middleware/upload.middleware');
    return processAndSave(`vehicles/${req.params.id}`)(req, res, next);
  },
  ctrl.uploadImages
);

module.exports = router;
