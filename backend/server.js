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
  // El frontend vive en vapss.net y la API en api.vapss.net, así que toda
  // llamada con Authorization lleva antes su preflight. Sin maxAge el
  // navegador apenas lo cachea (5 s en Chrome) y en el 4G de un técnico eso
  // es un ida y vuelta de más en casi cada petición. 24 h es el techo que
  // respetan Chrome y Firefox; pedir más no da más.
  maxAge: 86400,
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
    // Qué entorno es realmente: produccion o pre. Ambos corren con
    // NODE_ENV=production, así que sin esto no se distinguen desde fuera.
    appEnv:  process.env.APP_ENV || 'produccion',
    commit:  process.env.GIT_COMMIT || null,
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

  // Migraciones pendientes (idempotentes, ver src/config/migrations.js).
  // El deploy solo reconstruye el backend y nunca toca MySQL, así que este es
  // el único punto donde el esquema se pone al día en producción.
  const { runMigrations } = require('./src/config/migrations');
  const { fallida } = await runMigrations();
  if (fallida) {
    logger.error(`Esquema de BD incompleto: la migración '${fallida}' no se aplicó. ` +
                 `La API puede devolver 500 hasta que se resuelva.`);
  }

  // Cron: auto-activar trabajos y asignaciones programados cuya fecha_inicio ya pasó
  const { query: dbQuery } = require('./src/config/database');
  const { ahora } = require('./src/utils/fecha.utils');
  const avisosAsignacion = require('./src/services/avisosAsignacion.service');
  const vigilancia       = require('./src/services/vigilancia.service');
  const autoActivar = async () => {
    try {
      // El instante lo pone Node, no MySQL: fecha_inicio está en UTC y NOW()
      // devolvía la hora del servidor, así que los programados se activaban
      // una o dos horas antes de tiempo.
      const ahoraUtc = ahora();
      const [trab] = await dbQuery(
        `UPDATE trabajos SET estado = 'activo'
         WHERE estado = 'programado' AND fecha_inicio <= ? AND deleted_at IS NULL`,
        [ahoraUtc]
      );
      if (trab.affectedRows > 0) {
        logger.info(`Auto-activados ${trab.affectedRows} trabajo(s) programados`);
      }
      // Las asignaciones ya no se activan de un UPDATE masivo: hay que avisar
      // por push de cada una, y para eso hace falta saber CUÁLES han cambiado.
      // Primero se seleccionan las candidatas con sus datos (el aviso lleva el
      // nombre de la ambulancia y el del técnico) y después se actualiza una a
      // una con el guard `estado = 'programada'`. Ese UPDATE es lo que reclama
      // la fila: si el responsable acaba de pulsar «Inicio de servicio» en ese
      // hueco, aquí afecta a 0 filas y no se manda un segundo aviso.
      const [programadas] = await dbQuery(
        `SELECT al.id, al.user_id,
                v.alias AS vehiculo_alias, v.matricula,
                CONCAT(u.nombre,' ',u.apellidos) AS responsable_nombre
           FROM asignaciones_libres al
           JOIN vehicles v ON v.id = al.vehicle_id
           JOIN users u    ON u.id = al.user_id
          WHERE al.estado = 'programada'
            AND al.fecha_inicio <= ?
            AND al.deleted_at IS NULL`,
        [ahoraUtc]
      );

      let activadas = 0;
      for (const asignacion of programadas) {
        const [res] = await dbQuery(
          `UPDATE asignaciones_libres SET estado = 'activa'
           WHERE id = ? AND estado = 'programada'`,
          [asignacion.id]
        );
        if (res.affectedRows === 0) continue;   // se adelantó el responsable
        activadas++;
        avisosAsignacion.avisarAsignacionActivada(asignacion);
      }
      if (activadas > 0) {
        logger.info(`Auto-activadas ${activadas} asignación(es) programadas`);
      }
    } catch (err) {
      logger.error('Error en cron auto-activar:', err.message);
    }

    // Segunda pasada del mismo tick: asignaciones a las que se les pasó la
    // hora y nadie ha iniciado. Va DESPUÉS de activar a propósito — son las
    // mismas filas, y así el aviso mira el estado ya actualizado en vez del
    // del minuto anterior. Tiene su propio try/catch dentro.
    await vigilancia.revisarAsignacionesSinIniciar();
  };
  autoActivar();                       // ejecutar al arrancar para no esperar al 1er tick
  setInterval(autoActivar, 60 * 1000); // y luego cada minuto
  logger.info('Cron auto-activación de trabajos y asignaciones iniciado (cada 1 min)');
  logger.info(
    `Vigilancia de asignaciones sin iniciar: aviso a los admins a los ` +
    `${require('./src/config/constants').AVISO_SIN_INICIAR_MINUTOS} min`
  );
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
