/**
 * routes/admin.routes.js
 * Panel de superadmin: audit logs + error logs + estadísticas
 * Todas las rutas requieren rol superadmin.
 */

'use strict';

const express = require('express');
const { query: queryParam, param } = require('express-validator');
const ctrl   = require('../controllers/admin.controller');
const backups = require('../controllers/backups.controller');
const { authenticate }      = require('../middleware/auth.middleware');
const { requireSuperAdmin } = require('../middleware/roles.middleware');
const { handleValidation }  = require('../middleware/validate.middleware');

const router = express.Router();

// Todos los endpoints requieren estar autenticado Y ser superadmin
router.use(authenticate);
router.use(requireSuperAdmin);

// GET /admin/stats
router.get('/stats', ctrl.getAdminStats);

// GET /admin/audit/users  — usuarios con actividad (para el filtro)
router.get('/audit/users', ctrl.listAuditUsers);

// GET /admin/audit?page=&action=&user_id=&desde=&hasta=
router.get('/audit',
  [
    queryParam('page').optional().isInt({ min: 1 }),
    queryParam('limit').optional().isInt({ min: 1, max: 200 }),
    queryParam('user_id').optional().isInt({ min: 1 }),
    queryParam('action').optional().isString(),
    queryParam('desde').optional().isISO8601(),
    queryParam('hasta').optional().isISO8601(),
  ],
  handleValidation,
  ctrl.listAuditLogs
);

// GET /admin/errors?page=&desde=&hasta=&origen=servidor|cliente
router.get('/errors',
  [
    queryParam('page').optional().isInt({ min: 1 }),
    queryParam('origen').optional().isIn(['servidor', 'cliente']),
    queryParam('limit').optional().isInt({ min: 1, max: 200 }),
    queryParam('desde').optional().isISO8601(),
    queryParam('hasta').optional().isISO8601(),
  ],
  handleValidation,
  ctrl.listErrorLogs
);

// GET /admin/backups — dumps de la BD disponibles (docs/BACKUPS.md §9)
router.get('/backups', backups.listBackups);

// GET /admin/backups/:nombre — descarga de un dump. El patrón cierra el paso a
// cualquier ruta: solo nombres tal cual los escribe el script de backup.
router.get('/backups/:nombre',
  [param('nombre').matches(backups.PATRON_DUMP)],
  handleValidation,
  backups.downloadBackup
);

// POST /admin/impersonar/:id — token para ver la app como ese usuario.
// El requireSuperAdmin de arriba impide además encadenar: impersonando a un
// administrador ya no se es superadmin.
router.post('/impersonar/:id',
  [param('id').isInt({ min: 1 })],
  handleValidation,
  ctrl.impersonar
);

module.exports = router;
