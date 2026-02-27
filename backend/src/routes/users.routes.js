/**
 * routes/users.routes.js
 */

'use strict';

const express  = require('express');
const { body, param, query } = require('express-validator');
const ctrl     = require('../controllers/users.controller');
const { authenticate }       = require('../middleware/auth.middleware');
const { requireAdminOrGestor, requireAdmin } = require('../middleware/roles.middleware');
const { handleValidation }   = require('../middleware/validate.middleware');

const router = express.Router();

// Todas las rutas requieren autenticación
router.use(authenticate);

// GET /users/roles  - listar roles disponibles (todos los autenticados)
router.get('/roles', ctrl.listRoles);

// POST /users/roles  - crear rol (solo admin)
router.post('/roles',
  requireAdmin,
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
  requireAdminOrGestor,
  ctrl.listUsers
);

// GET /users/:id  - obtener usuario (admin o gestor)
router.get('/:id',
  requireAdminOrGestor,
  [param('id').isInt({ min: 1 }).withMessage('ID inválido')],
  handleValidation,
  ctrl.getUser
);

// POST /users  - crear usuario (solo admin)
router.post('/',
  requireAdmin,
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
  requireAdminOrGestor,
  [
    param('id').isInt({ min: 1 }).withMessage('ID inválido'),
    body('email').optional({ nullable: true }).isEmail().withMessage('Email inválido').normalizeEmail(),
    body('telefono').optional({ nullable: true }).isLength({ max: 20 }),
    body('roles').optional().isArray(),
  ],
  handleValidation,
  ctrl.updateUser
);

// DELETE /users/:id  - soft delete (solo admin)
router.delete('/:id',
  requireAdmin,
  [param('id').isInt({ min: 1 }).withMessage('ID inválido')],
  handleValidation,
  ctrl.deleteUser
);

module.exports = router;
