/**
 * middleware/rateLimiter.middleware.js
 * Rate limiting para endpoints críticos
 */

'use strict';

const rateLimit = require('express-rate-limit');
const { verifyAccessToken } = require('../utils/jwt.utils');
const logger = require('../utils/logger.utils');

/**
 * Clave de conteo del limitador general.
 *
 * Contar por IP es lo que rompía la app: la oficina sale a internet por una
 * sola IP pública y los técnicos comparten el NAT del operador móvil, así que
 * cuatro personas trabajando a la vez se repartían un único cupo y saltaba el
 * 429 sin que nadie hubiera hecho "muchas peticiones".
 *
 * Con un access token válido se cuenta por usuario. El token se verifica de
 * verdad (HS256, coste despreciable): si sólo se leyera el payload, cualquiera
 * podría inventarse un id por petición y saltarse el límite entero.
 *
 * Sin token válido se vuelve a la IP, que es la única identidad disponible.
 */
function claveCliente(req) {
  // El limitador pregunta la clave varias veces por petición (max, keyGenerator
  // y el handler del 429); se cachea para no verificar el mismo JWT tres veces.
  if (req._claveRateLimit) return req._claveRateLimit;
  req._claveRateLimit = calcularClaveCliente(req);
  return req._claveRateLimit;
}

function calcularClaveCliente(req) {
  const cabecera = req.headers['authorization'];
  if (cabecera && cabecera.startsWith('Bearer ')) {
    try {
      const decoded = verifyAccessToken(cabecera.slice(7));
      if (decoded?.type === 'access' && decoded.sub) return `u:${decoded.sub}`;
    } catch {
      // Token caducado o inválido: cae a la IP como cualquier anónimo.
    }
  }
  return `ip:${normalizarIp(req.ip)}`;
}

/**
 * Agrupa las IPv6 por su prefijo /64: un móvil rota su dirección temporal
 * (privacy extensions) varias veces al día y sin esto cada rotación estrenaría
 * cupo, dejando el límite en papel mojado para IPv6.
 */
function normalizarIp(ip) {
  if (!ip) return 'desconocida';
  const limpia = ip.replace(/^::ffff:/, '');
  if (!limpia.includes(':')) return limpia;
  return limpia.split(':').slice(0, 4).join(':') + '::/64';
}

function esAutenticado(req) {
  return claveCliente(req).startsWith('u:');
}

/** Deja rastro del 429 en el log: sin esto no había forma de saber a quién ni
 *  en qué endpoint se estaba cortando (morgan va a nivel verbose, silenciado). */
function avisar429(nombre) {
  return (req, res, _next, options) => {
    logger.warn(
      `429 ${nombre}: ${claveCliente(req)} ip=${req.ip} ${req.method} ${req.originalUrl}`
    );
    res.status(options.statusCode).json({
      ...options.message,
      retryAfter: Math.ceil(options.windowMs / 1000),
    });
  };
}

/**
 * Rate limiter general para toda la API.
 *
 * El cupo se mide por usuario, no por IP (ver claveCliente). Los 100 de antes
 * no daban ni para un servicio: abrir la app son ~3 llamadas, la ficha de un
 * vehículo ~8, y cerrar una asignación son 12 fotos + el finalize. Con 600 por
 * ventana un técnico puede completar su jornada sin rozar el límite, y sigue
 * siendo un tope efectivo contra un cliente desbocado.
 */
const MAX_AUTENTICADO = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 600;
const MAX_ANONIMO     = parseInt(process.env.RATE_LIMIT_MAX_ANON)     || 100;

const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max: (req) => (esAutenticado(req) ? MAX_AUTENTICADO : MAX_ANONIMO),
  keyGenerator: claveCliente,
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    success: false,
    // Sin "desde esta IP": ya no se cuenta por IP para quien va identificado,
    // y ese texto hacía pensar en un problema de red que no existía.
    message: 'Demasiadas solicitudes en poco tiempo. Espera un momento y vuelve a intentarlo.',
  },
  handler: avisar429('api'),
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
    logger.warn(`429 login: ip=${req.ip} usuario=${req.body?.username || '?'}`);
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
  handler: avisar429('refresh'),
});

/**
 * Rate limiter para subida de imágenes.
 *
 * Por usuario igual que el general: dos técnicos subiendo fotos desde la misma
 * furgoneta no tienen por qué estorbarse. 60/min cubre de sobra las 12 fotos de
 * un servicio aunque se reintente el envío entero.
 */
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minuto
  max:      parseInt(process.env.UPLOAD_RATE_LIMIT_MAX) || 60,
  keyGenerator: claveCliente,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Límite de subida de imágenes alcanzado.' },
  handler: avisar429('upload'),
});

/**
 * Rate limiter para el alta/baja y la prueba de avisos push.
 *
 * Por usuario, como el resto. 20 por minuto sobra para activar los avisos y
 * probarlos un par de veces, y pone techo a lo único que aquí tiene coste real
 * hacia fuera: cada /push/test dispara una petición al servicio de push del
 * fabricante del navegador.
 */
const pushLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minuto
  max:      parseInt(process.env.PUSH_RATE_LIMIT_MAX) || 20,
  keyGenerator: claveCliente,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, message: 'Demasiadas operaciones de avisos seguidas. Espera un momento.' },
  handler: avisar429('push'),
});

/**
 * POST /csp-report — informes de la CSP del frontend.
 *
 * Los manda el navegador solo, sin token, así que cuentan por IP. Va con cupo
 * PROPIO y montado antes de `apiLimiter`: si compartieran cupo, una página con
 * muchas violaciones gastaría el cupo anónimo de la IP y los técnicos de esa
 * misma red (comparten IP, ver rate limit por usuario) se comerían un 429 al
 * hacer login. Pasado el cupo se contesta 204 sin más: el navegador no
 * reintenta y no hay nada que avisar.
 */
const cspReportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      30,
  keyGenerator: (req) => `csp:${normalizarIp(req.ip)}`,
  standardHeaders: false,
  legacyHeaders:   false,
  handler: (_req, res) => res.status(204).end(),
});

module.exports = { apiLimiter, loginLimiter, refreshLimiter, uploadLimiter, pushLimiter, cspReportLimiter, claveCliente };
