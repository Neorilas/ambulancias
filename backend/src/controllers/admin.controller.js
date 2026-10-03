/**
 * controllers/admin.controller.js
 * Panel de superadmin: audit logs + error logs
 * Solo accesible con rol superadmin.
 */

'use strict';

const { query }    = require('../config/database');
const { success, paginated, error, notFound, forbidden } = require('../utils/response.utils');
const { PAGINATION, ROLES } = require('../config/constants');
const { generateImpersonationToken, IMPERSONATION_EXPIRY_MIN } = require('../utils/jwt.utils');
const { inicioDelDiaEnEspana, haceHoras } = require('../utils/fecha.utils');
const { contextoActual } = require('../utils/contextoPeticion.utils');

// ── Helper: log de auditoría ──────────────────────────────────────────────────
// Exportamos para que otros controladores puedan llamarlo.
//
// Si la petición la hace un superadmin impersonando a otro usuario, la fila
// sigue siendo del usuario impersonado (es su vista y sus datos los que se
// tocan) pero lleva al superadmin en `user_info` («jlopez (vía findelias)») y
// en `details.impersonado_por`. Sin esto, el historial diría que el técnico
// hizo algo que no hizo. `impersonadoPor` se puede pasar a mano para lo que
// corre fuera del contexto de la petición (el 403 se audita en 'finish').
async function logAudit({ userId, userInfo, action, entityType = null, entityId = null, details = null, ip = null, userAgent = null, impersonadoPor }) {
  try {
    const imp = impersonadoPor !== undefined ? impersonadoPor : contextoActual()?.impersonadoPor;
    if (imp && imp.id !== userId) {
      userInfo = `${userInfo || ''} (vía ${imp.username})`.slice(0, 200);
      details  = { ...(details || {}), impersonado_por: { id: imp.id, username: imp.username } };
    }
    await query(
      `INSERT INTO audit_logs (user_id, user_info, action, entity_type, entity_id, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId || null, userInfo || 'sistema', action, entityType, entityId,
       details ? JSON.stringify(details) : null, ip, userAgent?.substring(0, 500) || null]
    );
  } catch (err) {
    // No propagamos — un fallo de log no debe romper la operación principal
    console.error('[AUDIT] Error guardando audit log:', err.message);
  }
}

// ── Helper: log de error ───────────────────────────────────────────────────────
// `origen` = 'servidor' para los 5xx de errorHandler; 'cliente' para lo que
// manda la app (erroresCliente.controller). No lanza nunca, pero un fallo al
// grabar sí sale en el log: si no, el panel se queda vacío sin que nadie sepa
// por qué. Los textos se recortan a 16000 caracteres: TEXT son 65535 BYTES y
// en utf8mb4 un carácter puede ocupar 4 (el recorte anterior, a 65535
// caracteres, dejaba pasar textos que MySQL rechaza en modo estricto).
async function logError({ method, url, statusCode, errorMessage, stackTrace, userId, userInfo, ip,
  origen = 'servidor', userAgent = null, ocurridoAt = null }) {
  try {
    await query(
      `INSERT INTO error_logs (origen, method, url, status_code, error_message, stack_trace, user_id, user_info, ip_address, user_agent, ocurrido_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [origen, method || null, url?.substring(0, 1000) || null, statusCode || null,
       errorMessage?.substring(0, 16000) || null, stackTrace?.substring(0, 16000) || null,
       userId || null, userInfo || null, ip || null, userAgent?.substring(0, 500) || null,
       ocurridoAt, new Date()]
    );
  } catch (err) {
    console.error('[ERROR_LOG] No se pudo guardar en error_logs:', err.message);
  }
}

// ============================================================
// GET /admin/audit  — historial de acciones
// ============================================================
async function listAuditLogs(req, res, next) {
  try {
    const page    = Math.max(1, parseInt(req.query.page)  || PAGINATION.DEFAULT_PAGE);
    const limit   = Math.max(1, Math.min(parseInt(req.query.limit)    || 50, 200));
    const offset  = (page - 1) * limit;
    const action  = req.query.action  || null;
    const userId  = req.query.user_id ? parseInt(req.query.user_id) : null;
    const desde   = req.query.desde   || null;
    const hasta   = req.query.hasta   || null;

    let where  = 'WHERE 1=1';
    const params = [];

    if (action)  { where += ' AND action LIKE ?';       params.push(`%${action}%`); }
    if (userId)  { where += ' AND user_id = ?';         params.push(userId); }
    if (desde)   { where += ' AND created_at >= ?';     params.push(desde); }
    if (hasta)   { where += ' AND created_at <= ?';     params.push(hasta + ' 23:59:59'); }

    const [countRows] = await query(
      `SELECT COUNT(*) AS total FROM audit_logs ${where}`, params
    );
    const total = countRows[0].total;

    const [rows] = await query(
      `SELECT id, user_id, user_info, action, entity_type, entity_id,
              details, ip_address, created_at
       FROM audit_logs ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return paginated(res, { data: rows, total, page, limit });
  } catch (err) { next(err); }
}

// ============================================================
// GET /admin/errors  — errores del servidor (5xx) y de la app (?origen=)
// ============================================================
async function listErrorLogs(req, res, next) {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || PAGINATION.DEFAULT_PAGE);
    const limit  = Math.max(1, Math.min(parseInt(req.query.limit)   || 50, 200));
    const offset = (page - 1) * limit;
    const desde  = req.query.desde || null;
    const hasta  = req.query.hasta || null;

    let where  = 'WHERE 1=1';
    const params = [];

    const origen = ['servidor', 'cliente'].includes(req.query.origen) ? req.query.origen : null;

    if (desde)  { where += ' AND created_at >= ?';    params.push(desde); }
    if (hasta)  { where += ' AND created_at <= ?';    params.push(hasta + ' 23:59:59'); }
    if (origen) { where += ' AND origen = ?';         params.push(origen); }

    const [countRows] = await query(
      `SELECT COUNT(*) AS total FROM error_logs ${where}`, params
    );
    const total = countRows[0].total;

    const [rows] = await query(
      `SELECT id, origen, method, url, status_code, error_message, stack_trace,
              user_id, user_info, ip_address, user_agent, ocurrido_at, created_at
       FROM error_logs ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return paginated(res, { data: rows, total, page, limit });
  } catch (err) { next(err); }
}

// ============================================================
// GET /admin/audit/users  — usuarios con actividad auditada
// Para poblar el filtro "por usuario" del historial.
// ============================================================
async function listAuditUsers(req, res, next) {
  try {
    const [rows] = await query(
      // Etiqueta: la fila más reciente que NO sea impersonada; si solo hay
      // de esas, la más reciente. Sin esto el filtro llamaba al usuario
      // «gestor (vía admin)» en cuanto un superadmin actuaba como él.
      `SELECT user_id,
              SUBSTRING_INDEX(COALESCE(
                MAX(CASE WHEN user_info NOT LIKE '% (vía %)' THEN CONCAT(created_at, '||', user_info) END),
                MAX(CONCAT(created_at, '||', user_info))
              ), '||', -1) AS user_info,
              COUNT(*)        AS total,
              MAX(created_at) AS last_action
       FROM audit_logs
       WHERE user_id IS NOT NULL
       GROUP BY user_id
       ORDER BY last_action DESC`
    );
    return success(res, rows);
  } catch (err) { next(err); }
}

// ============================================================
// GET /admin/stats  — resumen rápido para el panel
// ============================================================
async function getAdminStats(req, res, next) {
  try {
    const [[totalAudit]] = await query('SELECT COUNT(*) AS n FROM audit_logs');
    const [[totalErrors]] = await query('SELECT COUNT(*) AS n FROM error_logs');
    const [[errorsHoy]]   = await query(
      'SELECT COUNT(*) AS n FROM error_logs WHERE created_at >= ?',
      [inicioDelDiaEnEspana()]
    );
    const [[loginsFallidos]] = await query(
      'SELECT COUNT(*) AS n FROM login_attempts WHERE success = 0 AND attempted_at >= ?',
      [haceHoras(24)]
    );
    const [topActions] = await query(
      `SELECT action, COUNT(*) AS total
       FROM audit_logs
       GROUP BY action ORDER BY total DESC LIMIT 5`
    );
    const [topUsers] = await query(
      `SELECT user_id, user_info, COUNT(*) AS total
       FROM audit_logs WHERE user_id IS NOT NULL
       GROUP BY user_id, user_info ORDER BY total DESC LIMIT 5`
    );

    return success(res, {
      audit_total:       totalAudit.n,
      errors_total:      totalErrors.n,
      errors_hoy:        errorsHoy.n,
      logins_fallidos_24h: loginsFallidos.n,
      top_actions:       topActions,
      top_users:         topUsers,
    });
  } catch (err) { next(err); }
}

// ============================================================
// POST /admin/impersonar/:id  — ver (y usar) la app como otro usuario
// ============================================================
// Devuelve un access token del usuario elegido con el superadmin dentro
// (`imp`). No hay refresh: dura IMPERSONATION_EXPIRY_MIN y el frontend vuelve
// entonces a la sesión del superadmin, que guarda aparte. A otro superadmin no
// se le impersona: sería una puerta para actuar como un igual sin rastro claro
// y no enseña nada que el propio superadmin no vea ya.
async function impersonar(req, res, next) {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (targetId === req.user.id) return error(res, 'No puedes impersonarte a ti mismo', 400);

    const [rows] = await query(
      `SELECT u.id, u.username, u.nombre, u.apellidos, u.activo, u.deleted_at,
              GROUP_CONCAT(r.nombre SEPARATOR ',') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       LEFT JOIN roles r ON ur.role_id = r.id
       WHERE u.id = ?
       GROUP BY u.id`,
      [targetId]
    );
    if (!rows.length || rows[0].deleted_at !== null) return notFound(res, 'Usuario');
    const target = rows[0];
    if (!target.activo) return error(res, 'El usuario está desactivado', 400);

    const roles = target.roles ? target.roles.split(',') : [];
    if (roles.includes(ROLES.SUPERADMIN)) {
      return forbidden(res, 'No se puede impersonar a otro superadmin');
    }

    const [permRows] = await query(
      `SELECT DISTINCT p.nombre
       FROM role_permissions rp
       JOIN permissions p ON rp.permission_id = p.id
       JOIN user_roles ur ON rp.role_id = ur.role_id
       WHERE ur.user_id = ?`,
      [target.id]
    );

    const accessToken = generateImpersonationToken(
      { id: target.id, username: target.username, roles }, req.user.id
    );

    await logAudit({
      userId:     req.user.id,
      userInfo:   req.user.username,
      action:     'impersonate_start',
      entityType: 'user',
      entityId:   target.id,
      details:    { impersonado: target.username },
      ip:         req.ip,
      userAgent:  req.headers['user-agent'],
    });

    return success(res, {
      accessToken,
      expiraEnMin: IMPERSONATION_EXPIRY_MIN,
      user: {
        id:          target.id,
        username:    target.username,
        nombre:      target.nombre,
        apellidos:   target.apellidos,
        roles,
        permissions: permRows.map(r => r.nombre),
      },
    });
  } catch (err) { next(err); }
}

module.exports = { logAudit, logError, listAuditLogs, listAuditUsers, listErrorLogs, getAdminStats, impersonar };
