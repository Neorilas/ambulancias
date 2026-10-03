/**
 * controllers/erroresCliente.controller.js
 * Recoge los errores que ve la app y que nunca llegan a Express: una subida
 * que agota el timeout con mala cobertura, un 502/503 de Caddy durante un
 * deploy, un fallo de JavaScript. Van a error_logs con origen = 'cliente' y
 * salen en la pestaña Errores del panel del superadmin.
 *
 * La app los guarda en una cola local y los manda en lote cuando puede (sin
 * red no hay forma de mandarlos en el momento). Por eso:
 * - Llegan varios por petición (máx. LOTE_MAX); lo que sobra se ignora.
 * - `ocurrido_at` lo dice el reloj del móvil: solo se acepta si cae en los
 *   últimos OCURRIDO_MAX_DIAS y no en el futuro (con margen); si no, NULL.
 *
 * Requiere sesión: así cada error lleva su usuario, y un anónimo no puede
 * llenar el panel de basura. Los errores de la pantalla de login se pierden,
 * y es un precio aceptable.
 */

'use strict';

const { logError } = require('./admin.controller');

const LOTE_MAX          = 20;
const OCURRIDO_MAX_DIAS = 7;
const MARGEN_FUTURO_MS  = 5 * 60 * 1000;
const TIPOS             = ['red', 'timeout', 'http', 'js', 'promesa'];

/** Texto recortado, o null si no es una cadena con algo. */
function texto(valor, max) {
  if (typeof valor !== 'string') return null;
  const t = valor.trim();
  return t ? t.slice(0, max) : null;
}

/** Instante del dispositivo como Date, solo si es verosímil. */
function ocurridoVerosimil(valor, ahoraMs = Date.now()) {
  if (typeof valor !== 'string') return null;
  const ms = Date.parse(valor);
  if (!Number.isFinite(ms)) return null;
  if (ms > ahoraMs + MARGEN_FUTURO_MS) return null;
  if (ms < ahoraMs - OCURRIDO_MAX_DIAS * 24 * 60 * 60 * 1000) return null;
  return new Date(ms);
}

/**
 * Normaliza un error del lote; null si no trae lo mínimo (tipo y mensaje).
 * En `url` va la petición que falló (si era de red/HTTP) o, si no, la página.
 */
function normalizar(e, ahoraMs) {
  if (!e || typeof e !== 'object') return null;
  const tipo    = TIPOS.includes(e.tipo) ? e.tipo : null;
  const mensaje = texto(e.mensaje, 2000);
  if (!tipo || !mensaje) return null;

  const status = Number.isInteger(e.status) && e.status >= 100 && e.status <= 599 ? e.status : null;
  const metodo = texto(e.metodo, 10)?.toUpperCase() || null;
  const pagina = texto(e.pagina, 300);
  const version = texto(e.version, 40);
  const detalle = [
    pagina  && `Página: ${pagina}`,
    version && `Versión app: ${version}`,
    texto(e.stack, 8000),
  ].filter(Boolean).join('\n');

  return {
    method:       metodo,
    url:          texto(e.url, 1000) || pagina,
    statusCode:   status,
    errorMessage: `[${tipo}] ${mensaje}`,
    stackTrace:   detalle || null,
    ocurridoAt:   ocurridoVerosimil(e.ocurrido_at, ahoraMs),
  };
}

// POST /errores-cliente   body: { errores: [ { tipo, mensaje, url?, metodo?, status?, stack?, pagina?, version?, ocurrido_at? } ] }
async function recibirErrores(req, res, next) {
  try {
    const lote = Array.isArray(req.body?.errores) ? req.body.errores.slice(0, LOTE_MAX) : [];
    const ahoraMs = Date.now();
    const userInfo = req.user.impersonadoPor
      ? `${req.user.username} (vía ${req.user.impersonadoPor.username})`
      : `${req.user.username} (${req.user.nombre})`;

    let guardados = 0;
    for (const bruto of lote) {
      const e = normalizar(bruto, ahoraMs);
      if (!e) continue;
      await logError({
        ...e,
        origen:    'cliente',
        userId:    req.user.id,
        userInfo,
        ip:        req.ip || req.socket?.remoteAddress,
        userAgent: req.get('user-agent') || null,
      });
      guardados++;
    }
    // 202 siempre que el cuerpo sea un lote: lo descartado no se reintenta
    // (la app vaciaría la cola igual), así que no hay nada que contestarle.
    return res.status(202).json({ success: true, data: { recibidos: lote.length, guardados } });
  } catch (err) { next(err); }
}

module.exports = { recibirErrores, normalizar, ocurridoVerosimil, LOTE_MAX };
