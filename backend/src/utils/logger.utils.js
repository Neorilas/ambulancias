/**
 * utils/logger.utils.js
 * Logger centralizado usando Winston
 */

'use strict';

const winston = require('winston');
const path    = require('path');
const fs      = require('fs');

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '../../logs');

// Winston ordena los niveles npm: error 0, warn 1, info 2, http 3, verbose 4,
// debug 5, silly 6 — y solo escribe lo que quede POR DEBAJO del nivel elegido.
// Con `info` (2), las peticiones de morgan (nivel `http`, 3) no se escribían en
// ningún sitio: por eso no había ni una línea de tráfico con la que diagnosticar
// nada. El suelo es `http` para que el registro de peticiones exista siempre;
// quien quiera más detalle sube a verbose/debug.
const NIVELES   = { error: 0, warn: 1, info: 2, http: 3, verbose: 4, debug: 5, silly: 6 };
const pedido    = process.env.LOG_LEVEL || 'http';
const LOG_LEVEL = (NIVELES[pedido] ?? NIVELES.http) < NIVELES.http ? 'http' : pedido;

// Crear directorio de logs si no existe
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp: ts, stack }) => {
  return `${ts} [${level.toUpperCase()}]: ${stack || message}`;
});

const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    // Consola - siempre activa (Railway/producción no tiene acceso a archivos)
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'production'
        ? combine(timestamp({ format: 'HH:mm:ss' }), logFormat)
        : combine(colorize(), timestamp({ format: 'HH:mm:ss' }), logFormat),
    }),
    // Archivo de errores
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level:    'error',
      maxsize:  5 * 1024 * 1024, // 5MB
      maxFiles: 5,
    }),
    // Archivo combinado
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize:  10 * 1024 * 1024,
      maxFiles: 10,
    }),
  ],
  exitOnError: false,
});

// `logger.http()` es el de Winston tal cual (nivel 3). Antes se reasignaba a
// `verbose` (4), que con cualquier nivel razonable queda fuera del corte.

if (pedido !== LOG_LEVEL) {
  logger.warn(`LOG_LEVEL="${pedido}" dejaría las peticiones HTTP sin registrar; se usa "${LOG_LEVEL}".`);
}

module.exports = logger;
