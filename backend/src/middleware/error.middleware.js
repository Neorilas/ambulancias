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
 * Graba un 5xx en error_logs para el panel del superadmin. La usa
 * errorHandler y también los controladores que contestan ellos mismos un 500
 * en vez de pasar el error con next(err) (informes, backups): sin esto, esos
 * fallos solo salían en el log del contenedor.
 */
function registrarErrorServidor(req, err, status = 500) {
  const { logError } = require('../controllers/admin.controller');
  logError({
    method:       req.method,
    url:          req.originalUrl,
    statusCode:   status,
    errorMessage: err?.message || String(err),
    stackTrace:   err?.stack,
    userId:       req.user?.id || null,
    userInfo:     req.user ? `${req.user.username} (${req.user.nombre})` : null,
    ip:           req.ip || req.socket?.remoteAddress,
    userAgent:    req.get?.('user-agent') || null,
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

  // Multipart roto o cortado (subirImagen, subirPdf): culpa de la petición, no un 5xx
  if (err.multipartRoto) {
    return res.status(400).json({
      success: false,
      message: err.multipartRoto === 'pdf'
        ? 'El PDF llegó incompleto o dañado. Vuelve a intentarlo.'
        : 'La foto llegó incompleta o dañada. Vuelve a intentarlo.',
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

  if (status >= 500) registrarErrorServidor(req, err, status);

  res.status(status).json({
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

module.exports = { notFound, errorHandler, registrarErrorServidor };
