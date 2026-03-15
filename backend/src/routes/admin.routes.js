/**
 * routes/admin.routes.js
 * Panel de superadmin: audit logs + error logs + estadísticas
 * Todas las rutas requieren rol superadmin.
 */

'use strict';

const express = require('express');
const { query: queryParam } = require('express-validator');
const ctrl   = require('../controllers/admin.controller');
const { authenticate }      = require('../middleware/auth.middleware');
const { requireSuperAdmin } = require('../middleware/roles.middleware');
const { handleValidation }  = require('../middleware/validate.middleware');

const router = express.Router();

// Todos los endpoints requieren estar autenticado Y ser superadmin
router.use(authenticate);
router.use(requireSuperAdmin);

// GET /admin/stats
router.get('/stats', ctrl.getAdminStats);

// GET /admin/audit?page=&action=&user_id=&desde=&hasta=
router.get('/audit',
  [
    queryParam('page').optional().isInt({ min: 1 }),
    queryParam('limit').optional().isInt({ min: 1, max: 200 }),
    queryParam('desde').optional().isISO8601(),
    queryParam('hasta').optional().isISO8601(),
  ],
  handleValidation,
  ctrl.listAuditLogs
);

// GET /admin/errors?page=&desde=&hasta=
router.get('/errors',
  [
    queryParam('page').optional().isInt({ min: 1 }),
    queryParam('limit').optional().isInt({ min: 1, max: 200 }),
    queryParam('desde').optional().isISO8601(),
    queryParam('hasta').optional().isISO8601(),
  ],
  handleValidation,
  ctrl.listErrorLogs
);

module.exports = router;
