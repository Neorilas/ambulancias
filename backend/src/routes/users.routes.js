/**
 * routes/users.routes.js
 */

'use strict';

const express  = require('express');
const { body, param, query } = require('express-validator');
const ctrl     = require('../controllers/users.controller');
const { authenticate }       = require('../middleware/auth.middleware');
const { requireRole }        = require('../middleware/roles.middleware');
const { ROLES }              = require('../config/constants');
const { handleValidation }   = require('../middleware/validate.middleware');

const router = express.Router();

// El superadmin es el rol por encima de todo, pero no está incluido en los
// alias `requireAdmin`/`requireAdminOrGestor` del middleware: aquí se añade
// explícitamente para que una cuenta solo-superadmin pueda gestionar usuarios
// (y, sobre todo, repartir el rol `superadmin`, que ya solo puede dar ella).
const soloAdmin     = requireRole(ROLES.ADMINISTRADOR, ROLES.SUPERADMIN);
const adminOGestor  = requireRole(ROLES.ADMINISTRADOR, ROLES.SUPERADMIN, ROLES.GESTOR);

// Todas las rutas requieren autenticación
router.use(authenticate);

// GET /users/roles  - listar roles disponibles. Solo lo usa el formulario de
// usuarios (admin/gestor); hasta 2026-09-26 estaba abierto a cualquier sesión.
router.get('/roles', adminOGestor, ctrl.listRoles);

// POST /users/roles  - crear rol (solo admin)
router.post('/roles',
  soloAdmin,
  [
    body('nombre').trim().notEmpty().withMessage('Nombre de rol requerido')
      .isLength({ max: 50 }).withMessage('Máximo 50 caracteres')
      .matches(/^[a-z_]+$/).withMessage('Solo letras minúsculas y guion bajo'),
  ],
  handleValidation,
  ctrl.createRole
);

// GET /users  - listar usuarios (admin o gestor)
router.get('/',
  adminOGestor,
  ctrl.listUsers
);

// GET /users/:id  - obtener usuario (admin o gestor)
router.get('/:id',
  adminOGestor,
  [param('id').isInt({ min: 1 }).withMessage('ID inválido')],
  handleValidation,
  ctrl.getUser
);

// POST /users  - crear usuario (admin o gestor). El gestor, solo por debajo de
// su rol: ni gestores ni administradores (motivoGestor en el controlador).
router.post('/',
  adminOGestor,
  [
    body('username').trim().notEmpty().withMessage('Username requerido')
      .isLength({ min: 3, max: 50 }).withMessage('Username: entre 3 y 50 caracteres')
      .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username: solo letras, números y guion bajo'),
    body('password').notEmpty().withMessage('Password requerido'),
    body('nombre').trim().notEmpty().withMessage('Nombre requerido'),
    body('apellidos').trim().notEmpty().withMessage('Apellidos requerido'),
    body('dni').trim().notEmpty().withMessage('DNI requerido')
      .isLength({ max: 20 }).withMessage('DNI demasiado largo'),
    body('email').optional({ nullable: true }).isEmail().withMessage('Email inválido').normalizeEmail(),
    body('roles').optional().isArray().withMessage('roles debe ser un array'),
    body('roles.*').optional().isString().withMessage('Cada rol debe ser un string'),
  ],
  handleValidation,
  ctrl.createUser
);

// PUT /users/:id  - actualizar usuario (admin o gestor)
router.put('/:id',
  adminOGestor,
  [
    param('id').isInt({ min: 1 }).withMessage('ID inválido'),
    body('email').optional({ nullable: true }).isEmail().withMessage('Email inválido').normalizeEmail(),
    body('telefono').optional({ nullable: true }).isLength({ max: 20 }),
    body('roles').optional().isArray().withMessage('roles debe ser un array'),
    body('roles.*').optional().isString().withMessage('Cada rol debe ser un string'),
  ],
  handleValidation,
  ctrl.updateUser
);

// POST /users/:id/reset-password  - resetear contraseña (admin o superadmin)
router.post('/:id/reset-password',
  soloAdmin,
  [
    param('id').isInt({ min: 1 }).withMessage('ID inválido'),
    body('password').optional({ nullable: true }).isString()
      .isLength({ min: 10 }).withMessage('Mínimo 10 caracteres'),
  ],
  handleValidation,
  ctrl.resetPassword
);

// DELETE /users/:id  - soft delete (solo admin)
router.delete('/:id',
  soloAdmin,
  [param('id').isInt({ min: 1 }).withMessage('ID inválido')],
  handleValidation,
  ctrl.deleteUser
);

module.exports = router;
