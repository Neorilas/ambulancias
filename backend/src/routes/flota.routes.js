/**
 * routes/flota.routes.js
 * Mapa de la flota (posiciones de Cartrack).
 *
 * **Superadmin siempre; administradores solo si el flag `menu_flota` está
 * encendido** desde el panel de superadmin. Gestores y personal de campo, no.
 *
 * No es el criterio del resto de pantallas de flota (`/vehicles` lo ven admin
 * y gestor sin más) y es a propósito: esto enseña dónde está cada vehículo en
 * tiempo casi real, y por tanto dónde está la persona que lo lleva. Que lo vea
 * más gente es una decisión que alguien tiene que tomar a mano, y queda
 * registrada en `audit_logs` como `toggle_feature`.
 *
 * Ojo: el flag se comprueba AQUÍ, no solo en el frontend. `ProtectedRoute`
 * oculta la pantalla, pero ocultar un menú no impide llamar al endpoint a
 * mano — el control de acceso de verdad es este.
 */

'use strict';

const express = require('express');
const ctrl    = require('../controllers/flota.controller');
const { authenticate }    = require('../middleware/auth.middleware');
const { requireRole }     = require('../middleware/roles.middleware');
const { requireFeature }  = require('../middleware/features.middleware');
const { ROLES }           = require('../config/constants');

const router = express.Router();

router.use(authenticate);
// Primero el rol (quién podría), después el flag (si está abierto). El
// superadmin pasa las dos: `requireFeature` le hace el mismo bypass que
// `hasPermission`.
router.use(requireRole(ROLES.SUPERADMIN, ROLES.ADMINISTRADOR));
router.use(requireFeature('menu_flota'));

// GET /flota/ubicaciones
router.get('/ubicaciones', ctrl.getUbicaciones);

module.exports = router;
