'use strict';

const express = require('express');
const ctrl = require('../controllers/features.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireSuperAdmin } = require('../middleware/roles.middleware');

const router = express.Router();

router.get('/active', authenticate, ctrl.getActiveFeatures);

router.get('/', authenticate, requireSuperAdmin, ctrl.listFeatures);
router.put('/:key', authenticate, requireSuperAdmin, ctrl.toggleFeature);

module.exports = router;
