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

// Caddy actúa como proxy inverso — confiar en X-Forwarded-For
app.set('trust proxy', 1);

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

  // Auto-ejecutar migraciones pendientes (idempotentes)
  try {
    const { query: dbRun } = require('./src/config/database');
    await dbRun(`CREATE TABLE IF NOT EXISTS app_features (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      feature_key   VARCHAR(60) NOT NULL UNIQUE,
      label         VARCHAR(100) NOT NULL,
      description   VARCHAR(255) DEFAULT NULL,
      category      VARCHAR(40) NOT NULL DEFAULT 'menu',
      enabled       TINYINT(1) NOT NULL DEFAULT 0,
      display_order INT NOT NULL DEFAULT 0,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await dbRun(`INSERT IGNORE INTO app_features (feature_key, label, description, category, enabled, display_order) VALUES
      ('menu_dashboard',        'Dashboard',         'Panel principal con resumen',                          'menu', 0, 10),
      ('menu_mis_trabajos',     'Mis Trabajos',      'Lista de trabajos asignados al usuario',               'menu', 0, 20),
      ('menu_trabajos',         'Trabajos',          'Lista general de todos los trabajos',                  'menu', 0, 30),
      ('menu_mis_asignaciones', 'Mis Asignaciones',  'Asignaciones libres del usuario',                      'menu', 1, 40),
      ('menu_asignaciones',     'Asignaciones',      'Gestión de asignaciones libres (admin/gestor)',        'menu', 1, 50),
      ('menu_vehiculos',        'Vehículos',         'Gestión de vehículos/ambulancias (admin/gestor)',      'menu', 1, 60),
      ('menu_usuarios',         'Usuarios',          'Gestión de usuarios del sistema (admin/gestor)',       'menu', 1, 70),
      ('menu_alertas',          'Alertas',           'Alertas de caducidad ITV/ITS/Tarjeta (admin)',         'menu', 1, 80)`);
    logger.info('Migration v9 (app_features) ejecutada correctamente');

    // Migration v10 — Línea base "solo vehículos" sobre BD existentes.
    // El INSERT IGNORE de arriba NO actualiza filas ya creadas, así que aplicamos
    // la nueva configuración de flags UNA SOLA VEZ (marcada en schema_migrations),
    // sin pisar los toggles que el superadmin haga después desde el panel.
    await dbRun(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name       VARCHAR(100) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [v10Rows] = await dbRun(
      `SELECT name FROM schema_migrations WHERE name = 'v10_baseline_vehiculos'`
    );
    if (!v10Rows.length) {
      await dbRun(`UPDATE app_features SET enabled = 0
                   WHERE feature_key IN ('menu_dashboard','menu_mis_trabajos','menu_trabajos')`);
      await dbRun(`UPDATE app_features SET enabled = 1
                   WHERE feature_key IN ('menu_mis_asignaciones','menu_asignaciones','menu_vehiculos','menu_usuarios','menu_alertas')`);
      await dbRun(`INSERT INTO schema_migrations (name) VALUES ('v10_baseline_vehiculos')`);
      logger.info('Migration v10 (baseline solo-vehículos) aplicada por primera vez');
    }

    // Migration v11 — Incidencias vinculadas a asignación + técnico responsable.
    const ensureColumn = async (table, column, alterSql) => {
      const [rows] = await dbRun(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
      );
      if (rows[0].c === 0) await dbRun(alterSql);
    };
    await ensureColumn('vehicle_incidencias', 'asignacion_id',
      `ALTER TABLE vehicle_incidencias
         ADD COLUMN asignacion_id INT UNSIGNED NULL DEFAULT NULL AFTER trabajo_id,
         ADD INDEX idx_vinc_asignacion (asignacion_id),
         ADD CONSTRAINT fk_vinc_asignacion FOREIGN KEY (asignacion_id)
           REFERENCES asignaciones_libres(id) ON DELETE SET NULL`);
    await ensureColumn('vehicle_incidencias', 'responsable_user_id',
      `ALTER TABLE vehicle_incidencias
         ADD COLUMN responsable_user_id INT UNSIGNED NULL DEFAULT NULL AFTER reported_by,
         ADD INDEX idx_vinc_responsable (responsable_user_id),
         ADD CONSTRAINT fk_vinc_responsable FOREIGN KEY (responsable_user_id)
           REFERENCES users(id) ON DELETE SET NULL`);
    logger.info('Migration v11 (incidencias asignación/responsable) verificada');
  } catch (err) {
    logger.warn('Migration v9/v10/v11 skip:', err.message);
  }

  // Cron: auto-activar trabajos y asignaciones programados cuya fecha_inicio ya pasó
  const { query: dbQuery } = require('./src/config/database');
  const autoActivar = async () => {
    try {
      const [trab] = await dbQuery(
        `UPDATE trabajos SET estado = 'activo'
         WHERE estado = 'programado' AND fecha_inicio <= NOW() AND deleted_at IS NULL`
      );
      if (trab.affectedRows > 0) {
        logger.info(`Auto-activados ${trab.affectedRows} trabajo(s) programados`);
      }
      const [asig] = await dbQuery(
        `UPDATE asignaciones_libres SET estado = 'activa'
         WHERE estado = 'programada' AND fecha_inicio <= NOW() AND deleted_at IS NULL`
      );
      if (asig.affectedRows > 0) {
        logger.info(`Auto-activadas ${asig.affectedRows} asignación(es) programadas`);
      }
    } catch (err) {
      logger.error('Error en cron auto-activar:', err.message);
    }
  };
  autoActivar();                       // ejecutar al arrancar para no esperar al 1er tick
  setInterval(autoActivar, 60 * 1000); // y luego cada minuto
  logger.info('Cron auto-activación de trabajos y asignaciones iniciado (cada 1 min)');
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
