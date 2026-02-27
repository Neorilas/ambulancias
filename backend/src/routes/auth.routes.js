/**
 * routes/auth.routes.js
 */

'use strict';

const express    = require('express');
const { body }   = require('express-validator');
const ctrl       = require('../controllers/auth.controller');
const { handleValidation }  = require('../middleware/validate.middleware');
const { authenticate }      = require('../middleware/auth.middleware');
const { loginLimiter, refreshLimiter } = require('../middleware/rateLimiter.middleware');

const router = express.Router();

// POST /auth/login
router.post('/login',
  loginLimiter,
  [
    body('username').trim().notEmpty().withMessage('Username requerido')
      .isLength({ max: 50 }).withMessage('Username demasiado largo'),
    body('password').notEmpty().withMessage('Password requerido'),
  ],
  handleValidation,
  ctrl.login
);

// POST /auth/refresh
router.post('/refresh',
  refreshLimiter,
  [body('refreshToken').notEmpty().withMessage('refreshToken requerido')],
  handleValidation,
  ctrl.refresh
);

// POST /auth/logout
router.post('/logout', ctrl.logout);

// GET /auth/me  (requiere autenticación)
router.get('/me', authenticate, ctrl.me);

module.exports = router;
