/**
 * routes/vehicles.routes.js
 */

'use strict';

const express = require('express');
const { body, param } = require('express-validator');
const ctrl    = require('../controllers/vehicles.controller');
const { authenticate }          = require('../middleware/auth.middleware');
const { requireAdminOrGestor, requireAdmin, requireRole } = require('../middleware/roles.middleware');
const { ROLES } = require('../config/constants');
const { handleValidation }      = require('../middleware/validate.middleware');
const { multerUpload, processAndSave } = require('../middleware/upload.middleware');
const { uploadLimiter }         = require('../middleware/rateLimiter.middleware');
const { IMAGEN_TIPOS }          = require('../config/constants');

const router = express.Router();
router.use(authenticate);

// GET /vehicles
router.get('/', ctrl.listVehicles);

// GET /vehicles/tarjeta-transporte/proximas  (admin o gestor)
// Debe ir ANTES de /:id para no colisionar con la ruta con parámetro
router.get('/tarjeta-transporte/proximas',
  requireAdminOrGestor,
  ctrl.listTarjetaTransporteProximas
);

// GET /vehicles/alertas  (admin o superadmin)
// Debe ir ANTES de /:id para no colisionar
router.get('/alertas',
  requireRole(ROLES.ADMINISTRADOR, ROLES.SUPERADMIN),
  ctrl.listAlertasVehiculos
);

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

// GET /vehicles/:id/historial  (admin o gestor)
// Historial completo de trabajos + fotos + responsables
router.get('/:id/historial',
  requireAdminOrGestor,
  [param('id').isInt({ min: 1 })],
  handleValidation,
  ctrl.getVehicleHistorial
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
    body('fecha_matriculacion').optional({ nullable: true }).isISO8601().withMessage('Fecha de matriculación inválida'),
    body('fecha_itv').optional({ nullable: true }).isISO8601().withMessage('Fecha ITV inválida'),
    body('fecha_its').optional({ nullable: true }).isISO8601().withMessage('Fecha ITS inválida'),
    body('fecha_tarjeta_transporte').optional({ nullable: true }).isISO8601().withMessage('Fecha tarjeta de transporte inválida'),
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
    body('fecha_matriculacion').optional({ nullable: true }).isISO8601(),
    body('fecha_itv').optional({ nullable: true }).isISO8601(),
    body('fecha_its').optional({ nullable: true }).isISO8601(),
    body('fecha_tarjeta_transporte').optional({ nullable: true }).isISO8601(),
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
// IMPORTANTE: multer antes de express-validator para que req.body esté disponible
router.post('/:id/images',
  uploadLimiter,
  multerUpload.single('image'),
  [
    param('id').isInt({ min: 1 }),
    body('tipo_imagen').notEmpty().isIn(IMAGEN_TIPOS)
      .withMessage(`tipo_imagen debe ser uno de: ${IMAGEN_TIPOS.join(', ')}`),
  ],
  handleValidation,
  async (req, res, next) => {
    return processAndSave(`vehicles/${req.params.id}`)(req, res, next);
  },
  ctrl.uploadImages
);

// ── Incidencias ───────────────────────────────────────────────

// GET  /vehicles/:id/incidencias        (admin o gestor)
router.get('/:id/incidencias',
  requireAdminOrGestor,
  [param('id').isInt({ min: 1 })],
  handleValidation,
  ctrl.listIncidencias
);

// POST /vehicles/:id/incidencias        (admin o gestor)
router.post('/:id/incidencias',
  requireAdminOrGestor,
  [
    param('id').isInt({ min: 1 }),
    body('descripcion').trim().notEmpty().withMessage('Descripción requerida'),
    body('tipo').optional().isIn(['dano_exterior','dano_interior','mecanico','fluido','electrico','otro']),
    body('gravedad').optional().isIn(['leve','moderado','grave']),
    body('trabajo_id').optional({ nullable: true }).isInt({ min: 1 }),
  ],
  handleValidation,
  ctrl.createIncidencia
);

// PATCH /vehicles/:vehicleId/incidencias/:incId  (admin o gestor)
router.patch('/:vehicleId/incidencias/:incId',
  requireAdminOrGestor,
  [
    param('vehicleId').isInt({ min: 1 }),
    param('incId').isInt({ min: 1 }),
    body('estado').optional().isIn(['pendiente','en_revision','resuelto']),
    body('gravedad').optional().isIn(['leve','moderado','grave']),
    body('descripcion').optional().trim(),
  ],
  handleValidation,
  ctrl.updateIncidencia
);

// ── Revisiones / mantenimiento ────────────────────────────────

// GET  /vehicles/:id/revisiones         (admin o gestor)
router.get('/:id/revisiones',
  requireAdminOrGestor,
  [param('id').isInt({ min: 1 })],
  handleValidation,
  ctrl.listRevisiones
);

// POST /vehicles/:id/revisiones         (admin o gestor)
router.post('/:id/revisiones',
  requireAdminOrGestor,
  [
    param('id').isInt({ min: 1 }),
    body('tipo').notEmpty().isIn(['itv','its','mantenimiento','revision_preventiva','reparacion','otro'])
      .withMessage('Tipo de revisión inválido'),
    body('fecha_revision').notEmpty().isISO8601().withMessage('Fecha de revisión requerida'),
    body('fecha_proxima').optional({ nullable: true }).isISO8601(),
    body('resultado').optional().isIn(['aprobado','rechazado','condicionado','realizado']),
    body('descripcion').optional().trim(),
    body('coste').optional({ nullable: true }).isFloat({ min: 0 }),
    body('realizado_por').optional().trim().isLength({ max: 200 }),
  ],
  handleValidation,
  ctrl.createRevision
);

// PUT  /vehicles/:vehicleId/revisiones/:revId  (admin o gestor)
router.put('/:vehicleId/revisiones/:revId',
  requireAdminOrGestor,
  [
    param('vehicleId').isInt({ min: 1 }),
    param('revId').isInt({ min: 1 }),
    body('tipo').optional().isIn(['itv','its','mantenimiento','revision_preventiva','reparacion','otro']),
    body('fecha_revision').optional().isISO8601(),
    body('fecha_proxima').optional({ nullable: true }).isISO8601(),
    body('resultado').optional().isIn(['aprobado','rechazado','condicionado','realizado']),
    body('coste').optional({ nullable: true }).isFloat({ min: 0 }),
    body('realizado_por').optional().trim().isLength({ max: 200 }),
  ],
  handleValidation,
  ctrl.updateRevision
);

// DELETE /vehicles/:vehicleId/revisiones/:revId  (solo admin)
router.delete('/:vehicleId/revisiones/:revId',
  requireAdmin,
  [
    param('vehicleId').isInt({ min: 1 }),
    param('revId').isInt({ min: 1 }),
  ],
  handleValidation,
  ctrl.deleteRevision
);

module.exports = router;
