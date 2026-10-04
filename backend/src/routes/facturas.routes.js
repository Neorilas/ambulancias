/**
 * routes/facturas.routes.js
 * Facturas de proveedores para descargar.
 *
 * Solo administradores y superadmin, por rol. Y OCULTA para el resto (decisión
 * del usuario, 2026-10-04): quien no lo es recibe el mismo 404 que una ruta
 * que no existe, no un 403 que confirme que está aquí (ocultarSalvoRoles).
 * El flag `menu_facturas` solo pone la pantalla en el menú, y tampoco se le
 * enseña al resto (features.controller, FLAGS_OCULTOS).
 *
 * El rol se comprueba ANTES de multer: un rechazo no llega a leer el PDF.
 */

'use strict';

const express = require('express');
const ctrl    = require('../controllers/facturas.controller');
const { authenticate, reabrirContexto } = require('../middleware/auth.middleware');
const { ocultarSalvoRoles } = require('../middleware/roles.middleware');
const { uploadLimiter } = require('../middleware/rateLimiter.middleware');
const { subirPdf }     = require('../middleware/upload.middleware');
const { ROLES }        = require('../config/constants');

const router = express.Router();

router.use(authenticate);
router.use(ocultarSalvoRoles(ROLES.SUPERADMIN, ROLES.ADMINISTRADOR));

router.get('/', ctrl.listFacturas);
// El buzón de facturas@ (services/buzonFacturas.service.js). Van antes de
// /:id para que «buzon» no se lea como un id.
router.get('/buzon', ctrl.getBuzon);
router.post('/buzon/revisar', ctrl.revisarBuzon);
// Paso 1 de la subida: lee el PDF y devuelve los datos, sin guardar (lectorFacturas.service.js)
router.post('/leer', uploadLimiter, subirPdf('fichero'), reabrirContexto, ctrl.leerFactura);
router.post('/', uploadLimiter, subirPdf('fichero'), reabrirContexto, ctrl.createFactura);
router.get('/:id/descarga', ctrl.downloadFactura);
router.delete('/:id', ctrl.deleteFactura);

module.exports = router;
