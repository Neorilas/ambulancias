/**
 * routes/index.js
 * Agregador de rutas de la API
 */

'use strict';

const express        = require('express');
const { apiLimiter, cspReportLimiter, erroresClienteLimiter } = require('../middleware/rateLimiter.middleware');
const { recibirInforme } = require('../controllers/csp.controller');
const { recibirErrores } = require('../controllers/erroresCliente.controller');
const { authenticate }   = require('../middleware/auth.middleware');
const { auditarAccesosDenegados } = require('../middleware/auditoria403.middleware');

const authRoutes     = require('./auth.routes');
const usersRoutes    = require('./users.routes');
const vehiclesRoutes = require('./vehicles.routes');
const trabajosRoutes     = require('./trabajos.routes');
const asignacionesRoutes = require('./asignaciones.routes');
const adminRoutes        = require('./admin.routes');
const featuresRoutes     = require('./features.routes');
const pushRoutes         = require('./push.routes');
const flotaRoutes        = require('./flota.routes');
const informesRoutes     = require('./informes.routes');

const router = express.Router();

// Informes de la CSP del frontend. ANTES de apiLimiter y con cupo propio: los
// manda el navegador sin token y no deben gastar el cupo anónimo de la IP
// (ver cspReportLimiter). El cuerpo llega como application/csp-report o
// application/reports+json, que el express.json global no parsea.
router.post('/csp-report',
  cspReportLimiter,
  express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '16kb' }),
  recibirInforme
);

// Aplicar rate limit global a toda la API
router.use(apiLimiter);

// Todo 403 a un usuario autenticado queda en la auditoría (access_denied)
router.use(auditarAccesosDenegados);

// Errores que ve la app y no llegan a Express (red, timeout, 502, JS) →
// error_logs con origen 'cliente'. Con sesión y cupo propio por usuario.
router.post('/errores-cliente', authenticate, erroresClienteLimiter, recibirErrores);

// Montar rutas
router.use('/auth',      authRoutes);
router.use('/users',     usersRoutes);
router.use('/vehicles',  vehiclesRoutes);
router.use('/trabajos',     trabajosRoutes);
router.use('/asignaciones', asignacionesRoutes);
router.use('/admin',        adminRoutes);
router.use('/features',     featuresRoutes);
router.use('/push',         pushRoutes);
router.use('/flota',        flotaRoutes);
router.use('/informes',     informesRoutes);

// Ruta raíz de la API - info básica
router.get('/', (_req, res) => {
  res.json({
    name:    'Ambulancias API',
    version: '1.0.0',
    endpoints: ['/auth', '/users', '/vehicles', '/trabajos', '/asignaciones', '/admin', '/push', '/flota', '/informes'],
  });
});

module.exports = router;
