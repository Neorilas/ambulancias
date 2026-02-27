/**
 * middleware/error.middleware.js
 * Manejador centralizado de errores Express
 */

'use strict';

const logger = require('../utils/logger.utils');
const multer = require('multer');

/**
 * 404 - Ruta no encontrada
 */
function notFound(req, res) {
  res.status(404).json({
    success: false,
    message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`,
  });
}

/**
 * Manejador global de errores
 */
function errorHandler(err, req, res, _next) {
  // Errores de Multer
  if (err instanceof multer.MulterError) {
    const msgs = {
      LIMIT_FILE_SIZE: 'El archivo supera el tamaño máximo permitido',
      LIMIT_UNEXPECTED_FILE: err.message || 'Campo de archivo inesperado',
    };
    return res.status(400).json({
      success: false,
      message: msgs[err.code] || `Error de upload: ${err.message}`,
    });
  }

  // Errores de validación de express-validator (lanzados manualmente)
  if (err.type === 'validation') {
    return res.status(422).json({
      success: false,
      message: 'Errores de validación',
      errors:  err.errors,
    });
  }

  // Errores de MySQL
  if (err.code === 'ER_DUP_ENTRY') {
    const field = err.message.match(/for key '(.+?)'/)?.[1] || 'campo';
    return res.status(409).json({
      success: false,
      message: `Ya existe un registro con ese valor en: ${field}`,
    });
  }

  if (err.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(400).json({
      success: false,
      message: 'Referencia a un registro que no existe',
    });
  }

  // Error genérico
  logger.error(`[${req.method} ${req.originalUrl}] ${err.message}`, err.stack);

  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

module.exports = { notFound, errorHandler };
