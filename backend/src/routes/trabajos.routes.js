/**
 * routes/trabajos.routes.js
 */

'use strict';

const express = require('express');
const { fechaApiAMysql } = require('../utils/fecha.utils');
const { body, param, query: qv } = require('express-validator');
const ctrl    = require('../controllers/trabajos.controller');
const { authenticate }             = require('../middleware/auth.middleware');
const { requireAdminOrGestor, requirePermission } = require('../middleware/roles.middleware');
const { handleValidation }         = require('../middleware/validate.middleware');
const { multerUpload, processAndSave } = require('../middleware/upload.middleware');
const { uploadLimiter }            = require('../middleware/rateLimiter.middleware');
const { requireTrabajoEvidenciaAccess } = require('../middleware/ownership.middleware');
const { TRABAJO_TIPOS, IMAGEN_TIPOS, PERMISSIONS } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

// Campos comunes de crear/editar. Que cada vehículo lleve al menos un
// responsable, sin repetir, lo comprueba el controlador (`leerVehiculos`),
// porque también acepta el `responsable_user_id` suelto del formulario viejo.
const validarCamposTrabajo = [
  body('descripcion').optional({ nullable: true }).isString().isLength({ max: 5000 }),
  body('ubicacion').optional({ nullable: true }).isString().isLength({ max: 255 })
    .withMessage('La ubicación no puede pasar de 255 caracteres'),
  body('vehiculos').optional().isArray(),
  body('vehiculos.*.vehicle_id').optional().isInt({ min: 1 }),
  body('vehiculos.*.responsables').optional().isArray({ min: 1 })
    .withMessage('Cada vehículo necesita al menos un responsable'),
  body('vehiculos.*.responsables.*').optional().isInt({ min: 1 }),
  body('vehiculos.*.responsable_user_id').optional().isInt({ min: 1 }),
  body('vehiculos.*.kilometros_inicio').optional({ nullable: true, checkFalsy: true }).isInt({ min: 0 }),
  body('usuarios').optional().isArray(),
  body('usuarios.*').optional().isInt({ min: 1 }),
];

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
    body('fecha_inicio').notEmpty().isISO8601().withMessage('fecha_inicio inválida').customSanitizer(fechaApiAMysql),
    body('fecha_fin').notEmpty().isISO8601().withMessage('fecha_fin inválida').customSanitizer(fechaApiAMysql),
    ...validarCamposTrabajo,
  ],
  handleValidation,
  ctrl.createTrabajo
);

// PUT /trabajos/:id  (admin o gestor)
router.put('/:id',
  requireAdminOrGestor,
  [
    param('id').isInt({ min: 1 }),
    body('nombre').optional().trim().notEmpty().withMessage('Nombre requerido').isLength({ max: 255 }),
    body('tipo').optional().isIn(Object.values(TRABAJO_TIPOS)),
    body('fecha_inicio').optional().isISO8601().withMessage('fecha_inicio inválida').customSanitizer(fechaApiAMysql),
    body('fecha_fin').optional().isISO8601().withMessage('fecha_fin inválida').customSanitizer(fechaApiAMysql),
    ...validarCamposTrabajo,
  ],
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

// Ciclo de vida POR VEHÍCULO: cada responsable activa y cierra el suyo. El
// permiso lo decide el controlador (responsable de ESE vehículo, o gestión).
const paramsVehiculo = [param('id').isInt({ min: 1 }), param('vehicleId').isInt({ min: 1 })];

// POST /trabajos/:id/vehiculos/:vehicleId/activar
router.post('/:id/vehiculos/:vehicleId/activar',
  paramsVehiculo,
  handleValidation,
  ctrl.activarVehiculo
);

// POST /trabajos/:id/vehiculos/:vehicleId/finalize  - cerrar un vehículo con evidencias
router.post('/:id/vehiculos/:vehicleId/finalize',
  [
    ...paramsVehiculo,
    body('kilometros_fin').notEmpty().withMessage('Faltan los kilómetros finales')
      .isInt({ min: 0 }).toInt(),
    body('motivo_finalizacion_anticipada').optional({ nullable: true }).isString(),
  ],
  handleValidation,
  ctrl.finalizeVehiculo
);

// POST /trabajos/:id/activar y /finalize — solo trabajos SIN vehículos, y
// solo gestión: no hay responsable de vehículo que lo haga.
router.post('/:id/activar',
  requirePermission(PERMISSIONS.MANAGE_TRABAJOS),
  [param('id').isInt({ min: 1 })],
  handleValidation,
  ctrl.activarTrabajo
);

router.post('/:id/finalize',
  requirePermission(PERMISSIONS.MANAGE_TRABAJOS),
  [
    param('id').isInt({ min: 1 }),
    body('motivo_finalizacion_anticipada').optional({ nullable: true }).isString(),
  ],
  handleValidation,
  ctrl.finalizeTrabajo
);

// POST /trabajos/:id/evidencias  - subir evidencia fotográfica
// IMPORTANTE: multer debe correr ANTES de express-validator para que req.body
// esté disponible con los campos del multipart/form-data
router.post('/:id/evidencias',
  uploadLimiter,
  multerUpload.single('image'),
  [
    param('id').isInt({ min: 1 }),
    body('vehicle_id').notEmpty().isInt({ min: 1 }).withMessage('vehicle_id requerido'),
    body('tipo_imagen').notEmpty().isIn(IMAGEN_TIPOS)
      .withMessage(`tipo_imagen debe ser: ${IMAGEN_TIPOS.join(', ')}`),
    body('momento').optional().isIn(['inicio', 'fin'])
      .withMessage('momento debe ser "inicio" o "fin"'),
  ],
  handleValidation,
  // Solo el responsable del vehículo en este trabajo (o quien gestiona
  // trabajos) puede escribir estas fotos: se sobrescriben entre sí
  requireTrabajoEvidenciaAccess,
  async (req, res, next) => {
    return processAndSave(`trabajos/${req.params.id}`)(req, res, next);
  },
  ctrl.uploadEvidencia
);

module.exports = router;
