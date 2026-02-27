/**
 * middleware/rateLimiter.middleware.js
 * Rate limiting para endpoints críticos
 */

'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Rate limiter general para toda la API
 */
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max:      parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    success: false,
    message: 'Demasiadas solicitudes desde esta IP. Intenta de nuevo más tarde.',
  },
  skip: (req) => {
    // No limitar health check
    return req.path === '/health';
  },
});

/**
 * Rate limiter estricto para el endpoint de login
 * 5 intentos por ventana de 15 minutos por IP
 */
const loginLimiter = rateLimit({
  windowMs:   parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:        parseInt(process.env.LOGIN_RATE_LIMIT_MAX) || 5,
  standardHeaders: true,
  legacyHeaders:   false,
  skipSuccessfulRequests: true, // No contar los logins exitosos
  message: {
    success: false,
    message: 'Demasiados intentos de inicio de sesión. Espera 15 minutos.',
    retryAfter: true,
  },
  handler: (req, res, _next, options) => {
    res.status(429).json({
      success:    false,
      message:    options.message.message,
      retryAfter: Math.ceil(options.windowMs / 1000 / 60) + ' minutos',
    });
  },
});

/**
 * Rate limiter para refresh token (más permisivo)
 */
const refreshLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 min
  max:      20,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Demasiadas solicitudes de refresco de token.' },
});

/**
 * Rate limiter para subida de imágenes
 */
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minuto
  max:      30,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Límite de subida de imágenes alcanzado.' },
});

module.exports = { apiLimiter, loginLimiter, refreshLimiter, uploadLimiter };
