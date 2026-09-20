/**
 * routes/flota.routes.js
 * Mapa de la flota (posiciones de Cartrack).
 *
 * **Solo superadmin.** No es el criterio del resto de pantallas de flota
 * (`/vehicles` lo ven admin y gestor) y es a propósito: esto enseña dónde está
 * cada vehículo en tiempo casi real, y por tanto dónde está la persona que lo
 * lleva. Se abre a menos gente, no a más, y ampliarlo debe ser una decisión
 * consciente — no el efecto secundario de copiar el middleware de al lado.
 */

'use strict';

const express = require('express');
const ctrl    = require('../controllers/flota.controller');
const { authenticate }      = require('../middleware/auth.middleware');
const { requireSuperAdmin } = require('../middleware/roles.middleware');

const router = express.Router();

router.use(authenticate);
router.use(requireSuperAdmin);

// GET /flota/ubicaciones
router.get('/ubicaciones', ctrl.getUbicaciones);

module.exports = router;
