/**
 * routes/almacen.routes.js
 * Almacén de material (v44, MAPA_CODIGO.md §2.10).
 *
 * Solo administradores y superadmin, por rol, y OCULTO para el resto como
 * Facturas (decisión del usuario, 2026-11-18: «solo ha de ser visible por los
 * administradores»): quien no lo es —también el gestor— recibe el mismo 404
 * que una ruta que no existe. El flag `menu_almacen` solo pone la pantalla en
 * el menú y tampoco se le enseña al resto (features.controller, FLAGS_OCULTOS).
 */

'use strict';

const express = require('express');
const ctrl    = require('../controllers/almacen.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { ocultarSalvoRoles } = require('../middleware/roles.middleware');
const { ROLES } = require('../config/constants');

const router = express.Router();

router.use(authenticate);
router.use(ocultarSalvoRoles(ROLES.SUPERADMIN, ROLES.ADMINISTRADOR));

router.get('/productos', ctrl.listProductos);
router.post('/productos', ctrl.createProducto);
router.get('/productos/:id', ctrl.getProducto);
router.put('/productos/:id', ctrl.updateProducto);
router.put('/lotes/:id', ctrl.updateLote);
router.post('/lotes/:id/recuento', ctrl.recuentoLote);
router.get('/movimientos', ctrl.listMovimientos);
router.post('/movimientos', ctrl.createMovimiento);

module.exports = router;
