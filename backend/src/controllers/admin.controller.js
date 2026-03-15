/**
 * controllers/admin.controller.js
 * Panel de superadmin: audit logs + error logs
 * Solo accesible con rol superadmin.
 */

'use strict';

const { query }    = require('../config/database');
const { success, paginated } = require('../utils/response.utils');
const { PAGINATION } = require('../config/constants');

// ── Helper: log de auditoría ──────────────────────────────────────────────────
// Exportamos para que otros controladores puedan llamarlo.
async function logAudit({ userId, userInfo, action, entityType = null, entityId = null, details = null, ip = null, userAgent = null }) {
  try {
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
async function logError({ method, url, statusCode, errorMessage, stackTrace, userId, userInfo, ip }) {
  try {
    await query(
      `INSERT INTO error_logs (method, url, status_code, error_message, stack_trace, user_id, user_info, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [method, url?.substring(0, 1000), statusCode, errorMessage?.substring(0, 65535),
       stackTrace?.substring(0, 65535), userId || null, userInfo || null, ip]
    );
  } catch {
    // Ignorar silenciosamente
  }
}

// ============================================================
// GET /admin/audit  — historial de acciones
// ============================================================
async function listAuditLogs(req, res, next) {
  try {
    const page    = Math.max(1, parseInt(req.query.page)  || PAGINATION.DEFAULT_PAGE);
    const limit   = Math.min(parseInt(req.query.limit)    || 50, 200);
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
// GET /admin/errors  — log de errores del servidor
// ============================================================
async function listErrorLogs(req, res, next) {
  try {
    const page   = Math.max(1, parseInt(req.query.page) || PAGINATION.DEFAULT_PAGE);
    const limit  = Math.min(parseInt(req.query.limit)   || 50, 200);
    const offset = (page - 1) * limit;
    const desde  = req.query.desde || null;
    const hasta  = req.query.hasta || null;

    let where  = 'WHERE 1=1';
    const params = [];

    if (desde) { where += ' AND created_at >= ?';    params.push(desde); }
    if (hasta) { where += ' AND created_at <= ?';    params.push(hasta + ' 23:59:59'); }

    const [countRows] = await query(
      `SELECT COUNT(*) AS total FROM error_logs ${where}`, params
    );
    const total = countRows[0].total;

    const [rows] = await query(
      `SELECT id, method, url, status_code, error_message, user_id, user_info, ip_address, created_at
       FROM error_logs ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return paginated(res, { data: rows, total, page, limit });
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
      "SELECT COUNT(*) AS n FROM error_logs WHERE created_at >= CURDATE()"
    );
    const [[loginsFallidos]] = await query(
      "SELECT COUNT(*) AS n FROM login_attempts WHERE success = 0 AND attempted_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)"
    );
    const [topActions] = await query(
      `SELECT action, COUNT(*) AS total
       FROM audit_logs
       GROUP BY action ORDER BY total DESC LIMIT 5`
    );
    const [topUsers] = await query(
      `SELECT user_info, COUNT(*) AS total
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

module.exports = { logAudit, logError, listAuditLogs, listErrorLogs, getAdminStats };
