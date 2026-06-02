'use strict';

const { query } = require('../config/database');
const { success } = require('../utils/response.utils');

async function listFeatures(req, res, next) {
  try {
    const [rows] = await query(
      'SELECT feature_key, label, description, category, enabled, display_order FROM app_features ORDER BY display_order'
    );
    return success(res, rows);
  } catch (err) { next(err); }
}

async function toggleFeature(req, res, next) {
  try {
    const { key } = req.params;
    const { enabled } = req.body;

    const [result] = await query(
      'UPDATE app_features SET enabled = ? WHERE feature_key = ?',
      [enabled ? 1 : 0, key]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Feature no encontrada' });
    }

    const { logAudit } = require('./admin.controller');
    logAudit({
      userId: req.user.id,
      userInfo: `${req.user.username} (${req.user.nombre || ''})`,
      action: 'toggle_feature',
      entityType: 'app_features',
      details: { feature_key: key, enabled: !!enabled },
      ip: req.ip,
    });

    return success(res, { feature_key: key, enabled: !!enabled });
  } catch (err) { next(err); }
}

async function getActiveFeatures(req, res, next) {
  try {
    const [rows] = await query(
      'SELECT feature_key FROM app_features WHERE enabled = 1'
    );
    return success(res, rows.map(r => r.feature_key));
  } catch (err) { next(err); }
}

module.exports = { listFeatures, toggleFeature, getActiveFeatures };
