/**
 * routes/trabajos.routes.js
 */

'use strict';

const express = require('express');
const { fechaApiAMysql } = require('../utils/fecha.utils');
const { body, param, query: qv } = require('express-validator');
const ctrl    = require('../controllers/trabajos.controller');
const { authenticate, reabrirContexto } = require('../middleware/auth.middleware');
const { requireAdminOrGestor, requirePermission } = require('../middleware/roles.middleware');
const { handleValidation }         = require('../middleware/validate.middleware');
const { subirImagen, processAndSave } = require('../middleware/upload.middleware');
const { uploadLimiter }            = require('../middleware/rateLimiter.middleware');
const { requireTrabajoEvidenciaAccess } = require('../middleware/ownership.middleware');
const { TRABAJO_TIPOS, IMAGEN_TIPOS, PERMISSIONS } = require('../config/constants');
const { limpiarMilesKm } = require('../utils/km.utils');

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

// Las ambulancias del alta (v33): cada una es una asignación. Pueden ser
// ninguna (2026-10-10). Que no se repitan y las fechas por defecto las decide
// el controlador (`leerAmbulancias`); aquí, la forma y los tamaños, con los
// mismos topes que POST /asignaciones.
const validarAmbulanciasAlta = [
  body('asignaciones').optional().isArray({ max: 20 }),
  body('asignaciones.*.vehicle_id').isInt({ min: 1 }),
  body('asignaciones.*.responsables').isArray({ min: 1, max: 20 })
    .withMessage('Cada ambulancia necesita al menos un responsable'),
  body('asignaciones.*.responsables.*').isInt({ min: 1 }),
  body('asignaciones.*.personal').optional().isArray({ max: 30 }),
  body('asignaciones.*.personal.*').isInt({ min: 1 }),
  body('asignaciones.*.fecha_inicio').optional({ nullable: true, checkFalsy: true })
    .isISO8601().customSanitizer(fechaApiAMysql),
  body('asignaciones.*.fecha_fin').optional({ nullable: true, checkFalsy: true })
    .isISO8601().customSanitizer(fechaApiAMysql),
  body('asignaciones.*.km_inicio').optional({ nullable: true })
    .customSanitizer(limpiarMilesKm).isInt({ min: 0 }),
  body('asignaciones.*.notas').optional({ nullable: true }).isString().isLength({ max: 1000 }),
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
    // D1: cualquier usuario activo; no hace falta que vaya en una ambulancia
    body('coordinador_user_id').notEmpty().withMessage('Falta el coordinador del trabajo').isInt({ min: 1 }),
    ...validarCamposTrabajo,
    ...validarAmbulanciasAlta,
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
    // Se puede cambiar, no quitar: todo trabajo nuevo tiene quien lo cierre
    body('coordinador_user_id').optional().isInt({ min: 1 }),
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

// POST /trabajos/:id/cerrar — D3: lo cierra su coordinador (o gestión) con
// todas sus ambulancias finalizadas. Quién puede lo decide el controlador,
// porque depende del trabajo concreto (es SU coordinador).
router.post('/:id/cerrar',
  [param('id').isInt({ min: 1 })],
  handleValidation,
  ctrl.cerrarTrabajo
);

// Ciclo de vida POR VEHÍCULO (modelo v25): cada responsable activa y cierra el suyo. El
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
    body('motivo_finalizacion_anticipada').optional({ nullable: true }).isString()
      .isLength({ max: 2000 }).withMessage('Motivo demasiado largo (máx. 2000)'),
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
    body('motivo_finalizacion_anticipada').optional({ nullable: true }).isString()
      .isLength({ max: 2000 }).withMessage('Motivo demasiado largo (máx. 2000)'),
  ],
  handleValidation,
  ctrl.finalizeTrabajo
);

// POST /trabajos/:id/evidencias  - subir evidencia fotográfica
// IMPORTANTE: multer debe correr ANTES de express-validator para que req.body
// esté disponible con los campos del multipart/form-data
router.post('/:id/evidencias',
  uploadLimiter,
  subirImagen('image'),
  reabrirContexto, // refuerzo: el contexto de la petición, aunque cambie el parser (BUG-03)
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
