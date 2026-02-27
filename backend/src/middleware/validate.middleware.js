/**
 * middleware/validate.middleware.js
 * Extrae y devuelve errores de express-validator
 */

'use strict';

const { validationResult } = require('express-validator');
const { validationError }  = require('../utils/response.utils');

/**
 * Middleware que comprueba si hay errores de validación
 * y retorna 422 si los hay.
 * Debe colocarse DESPUÉS de los validators de express-validator.
 */
function handleValidation(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return validationError(res,
      errors.array().map(e => ({ field: e.path, message: e.msg }))
    );
  }
  next();
}

module.exports = { handleValidation };
