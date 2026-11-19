/**
 * routes/inventario.routes.js
 * Inventario de cada ambulancia (v46, MAPA_CODIGO.md §2.10).
 *
 * Lo VEN administradores, gestores y superadmin; para el resto no existe: el
 * mismo 404 que una ruta inventada, como el almacén (ocultarSalvoRoles). Lo
 * CAMBIAN solo administradores y superadmin: el gestor recibe 403 (ya sabe
 * que existe, lo está viendo).
 *
 * Va aparte de /almacen a propósito: el almacén sigue siendo solo de
 * administración y el gestor no debe ver stock, lotes ni movimientos.
 */

'use strict';

const express = require('express');
const ctrl    = require('../controllers/inventario.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { ocultarSalvoRoles, requireRole } = require('../middleware/roles.middleware');
const { ROLES } = require('../config/constants');

const router = express.Router();
const soloAdministracion = requireRole(ROLES.SUPERADMIN, ROLES.ADMINISTRADOR);

router.use(authenticate);
router.use(ocultarSalvoRoles(ROLES.SUPERADMIN, ROLES.ADMINISTRADOR, ROLES.GESTOR));

router.get('/ambulancias', ctrl.listAmbulancias);
router.get('/ambulancias/:id', ctrl.getAmbulancia);
router.post('/ambulancias/:id/lineas', soloAdministracion, ctrl.createLinea);
router.put('/lineas/:id', soloAdministracion, ctrl.updateLinea);
router.delete('/lineas/:id', soloAdministracion, ctrl.deleteLinea);

module.exports = router;
