/**
 * utils/response.utils.js
 * Helpers para respuestas HTTP consistentes
 */

'use strict';

/**
 * Respuesta de éxito
 */
const success = (res, data = null, message = 'OK', status = 200) => {
  const body = { success: true, message };
  if (data !== null) body.data = data;
  return res.status(status).json(body);
};

/**
 * Respuesta de creación (201)
 */
const created = (res, data = null, message = 'Recurso creado') =>
  success(res, data, message, 201);

/**
 * Respuesta de error
 */
const error = (res, message = 'Error interno', status = 500, errors = null) => {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  if (process.env.NODE_ENV === 'development' && status === 500) {
    body.hint = 'Revisa los logs del servidor para más información';
  }
  return res.status(status).json(body);
};

/**
 * Respuesta 404 Not Found
 */
const notFound = (res, resource = 'Recurso') =>
  error(res, `${resource} no encontrado`, 404);

/**
 * Respuesta 401 Unauthorized
 */
const unauthorized = (res, message = 'No autorizado') =>
  error(res, message, 401);

/**
 * Respuesta 403 Forbidden
 */
const forbidden = (res, message = 'Acceso denegado') =>
  error(res, message, 403);

/**
 * Respuesta 422 Unprocessable Entity (errores de validación)
 */
const validationError = (res, errors) =>
  error(res, 'Errores de validación', 422, errors);

/**
 * Respuesta paginada
 */
const paginated = (res, { data, total, page, limit }) => {
  return res.status(200).json({
    success: true,
    data,
    pagination: {
      total,
      page:        parseInt(page),
      limit:       parseInt(limit),
      totalPages:  Math.ceil(total / limit),
      hasNext:     page * limit < total,
      hasPrev:     page > 1,
    },
  });
};

module.exports = { success, created, error, notFound, unauthorized, forbidden, validationError, paginated };
