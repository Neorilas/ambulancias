/**
 * routes/facturas.routes.js
 * Facturas de proveedores para descargar.
 *
 * Solo administradores y superadmin, por rol (como /informes): son documentos
 * de la empresa, no de la operativa. El flag `menu_facturas` solo pone la
 * pantalla en el menú; el acceso lo decide esto.
 *
 * El rol se comprueba ANTES de multer: un 403 no llega a leer el PDF.
 */

'use strict';

const express = require('express');
const ctrl    = require('../controllers/facturas.controller');
const { authenticate, reabrirContexto } = require('../middleware/auth.middleware');
const { requireRole }  = require('../middleware/roles.middleware');
const { uploadLimiter } = require('../middleware/rateLimiter.middleware');
const { subirPdf }     = require('../middleware/upload.middleware');
const { ROLES }        = require('../config/constants');

const router = express.Router();

router.use(authenticate);
router.use(requireRole(ROLES.SUPERADMIN, ROLES.ADMINISTRADOR));

router.get('/', ctrl.listFacturas);
// El buzón de facturas@ (services/buzonFacturas.service.js). Van antes de
// /:id para que «buzon» no se lea como un id.
router.get('/buzon', ctrl.getBuzon);
router.post('/buzon/revisar', ctrl.revisarBuzon);
router.post('/', uploadLimiter, subirPdf('fichero'), reabrirContexto, ctrl.createFactura);
router.get('/:id/descarga', ctrl.downloadFactura);
router.delete('/:id', ctrl.deleteFactura);

module.exports = router;
