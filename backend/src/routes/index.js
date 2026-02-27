/**
 * routes/index.js
 * Agregador de rutas de la API
 */

'use strict';

const express        = require('express');
const { apiLimiter } = require('../middleware/rateLimiter.middleware');

const authRoutes     = require('./auth.routes');
const usersRoutes    = require('./users.routes');
const vehiclesRoutes = require('./vehicles.routes');
const trabajosRoutes = require('./trabajos.routes');

const router = express.Router();

// Aplicar rate limit global a toda la API
router.use(apiLimiter);

// Montar rutas
router.use('/auth',      authRoutes);
router.use('/users',     usersRoutes);
router.use('/vehicles',  vehiclesRoutes);
router.use('/trabajos',  trabajosRoutes);

// Ruta raíz de la API - info básica
router.get('/', (_req, res) => {
  res.json({
    name:    'Ambulancias API',
    version: '1.0.0',
    endpoints: ['/auth', '/users', '/vehicles', '/trabajos'],
  });
});

module.exports = router;
