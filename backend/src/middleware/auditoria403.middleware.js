/**
 * middleware/auditoria403.middleware.js
 * Deja en la auditoría TODO 403 que responda la API a un usuario autenticado.
 *
 * Antes solo se auditaban los de `requirePermission` y `requireFeature`. Los
 * que decide el controlador (ver un vehículo ajeno, subir fotos a una
 * asignación de otro) y los de `ownership`/`requireRole` salían sin rastro:
 * justo los intentos de tocar lo que no es de uno. Mirar el status al
 * terminar la respuesta los cubre todos, y los que se añadan mañana, sin
 * depender de que cada `forbidden(res)` se acuerde.
 *
 * Los middlewares que ya auditan con más detalle (el permiso o la
 * funcionalidad que faltaba) marcan `req._accesoDenegadoAuditado` para que
 * aquí no se duplique la fila.
 */

'use strict';

function auditarAccesosDenegados(req, res, next) {
  const jsonOriginal = res.json.bind(res);
  res.json = (cuerpo) => {
    if (res.statusCode === 403) req._motivo403 = cuerpo?.message;
    return jsonOriginal(cuerpo);
  };

  res.on('finish', () => {
    if (res.statusCode !== 403 || !req.user || req._accesoDenegadoAuditado) return;
    try {
      const { logAudit } = require('../controllers/admin.controller');
      logAudit({
        userId:   req.user.id,
        userInfo: req.user.username,
        action:   'access_denied',
        details:  {
          method: req.method,
          url:    req.originalUrl?.split('?')[0],
          motivo: typeof req._motivo403 === 'string' ? req._motivo403.slice(0, 200) : undefined,
        },
        ip:        req.ip,
        userAgent: req.headers?.['user-agent'],
      });
    } catch { /* la auditoría nunca rompe una respuesta ya enviada */ }
  });

  next();
}

module.exports = { auditarAccesosDenegados };
