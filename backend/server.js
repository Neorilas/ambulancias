/**
 * server.js - Punto de entrada del servidor Express
 * Sistema de Gestión de Ambulancias - API REST
 */

'use strict';

require('dotenv').config();

const express  = require('express');
const helmet   = require('helmet');
const cors     = require('cors');
const morgan   = require('morgan');
const compress = require('compression');
const path     = require('path');

const { testConnection } = require('./src/config/database');
const routes            = require('./src/routes/index');
const { errorHandler, notFound } = require('./src/middleware/error.middleware');
const logger            = require('./src/utils/logger.utils');

const app  = express();
const PORT = process.env.PORT || 3001;
const API  = `/api/${process.env.API_VERSION || 'v1'}`;

// ============================================================
// Middlewares de seguridad y utilidad
// ============================================================

// Cabeceras de seguridad HTTP
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // para imágenes
}));

// CORS configurado por entorno
app.use(cors({
  origin:      process.env.CORS_ORIGIN?.split(',') || 'http://localhost:5173',
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Compresión gzip
app.use(compress());

// Logging HTTP
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
  stream: { write: (msg) => logger.http(msg.trim()) },
}));

// Parseo JSON y URL-encoded con límite de tamaño
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Servir archivos estáticos (imágenes subidas)
app.use('/uploads', express.static(
  path.join(__dirname, process.env.UPLOADS_DIR || 'uploads'),
  {
    maxAge:    '7d',
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }
));

// ============================================================
// Rutas API
// ============================================================
app.use(API, routes);

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status:  'ok',
    version: process.env.npm_package_version || '1.0.0',
    env:     process.env.NODE_ENV,
    ts:      new Date().toISOString(),
  });
});

// ============================================================
// Manejo de errores (debe ir al final)
// ============================================================
app.use(notFound);
app.use(errorHandler);

// ============================================================
// Arranque del servidor
// ============================================================
async function connectWithRetry(retriesLeft = 10, delayMs = 3000) {
  try {
    await testConnection();
    logger.info('Conexión a MySQL establecida correctamente');
  } catch (err) {
    logger.error(`Error conectando a MySQL (${retriesLeft} intentos restantes): ${err.message}`);
    if (retriesLeft === 0) {
      logger.error('No se pudo conectar a MySQL tras todos los intentos. Saliendo.');
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, delayMs));
    return connectWithRetry(retriesLeft - 1, delayMs);
  }
}

async function startServer() {
  // Escuchar PRIMERO para que el health check de Railway responda
  // mientras se establece la conexión a la BD.
  await new Promise((resolve, reject) => {
    app.listen(PORT, (err) => {
      if (err) return reject(err);
      logger.info(`Servidor iniciado en puerto ${PORT} [${process.env.NODE_ENV}]`);
      logger.info(`API disponible en http://localhost:${PORT}${API}`);
      resolve();
    });
  });

  // Conectar a la BD con reintentos (no bloquea el health check)
  await connectWithRetry();
}

// Manejo de errores no capturados
process.on('unhandledRejection', (reason) => {
  logger.error('UnhandledRejection:', reason);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('UncaughtException:', err);
  process.exit(1);
});

startServer();

module.exports = app; // Para tests
