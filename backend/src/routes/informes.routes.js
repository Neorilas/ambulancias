/**
 * routes/informes.routes.js
 * Informes para administración.
 *
 * Solo administradores y superadmin (decisión de 2026-09-27): el informe
 * lleva un desglose nominal por técnico — puntualidad de cada persona —, y eso
 * no lo ven gestores ni personal de campo. El flag `menu_informes` solo pone
 * la pantalla en el menú; el acceso lo decide el rol, aquí.
 */

'use strict';

const express = require('express');
const ctrl    = require('../controllers/informes.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole }  = require('../middleware/roles.middleware');
const { ROLES }        = require('../config/constants');

const router = express.Router();

router.use(authenticate);
router.use(requireRole(ROLES.SUPERADMIN, ROLES.ADMINISTRADOR));

// GET /informes/mensual?mes=YYYY-MM
router.get('/mensual', ctrl.getInformeMensual);

module.exports = router;
