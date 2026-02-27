/**
 * utils/logger.utils.js
 * Logger centralizado usando Winston
 */

'use strict';

const winston = require('winston');
const path    = require('path');
const fs      = require('fs');

const LOG_DIR   = process.env.LOG_DIR || path.join(__dirname, '../../logs');
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

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

// Nivel custom para HTTP (morgan)
logger.http = (msg) => logger.verbose(msg);

module.exports = logger;
