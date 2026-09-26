import api from './api.js';

/**
 * services/informes.service.js
 * Informe mensual para administración. Solo admin y superadmin: cualquier
 * otro se lleva un 403 del backend (routes/informes.routes.js).
 */
export const informesService = {
  /**
   * `mes` en formato 'YYYY-MM' (sin él, el mes en curso). Devuelve
   * `{ actual, comparativa: { anterior, anio_anterior } }`; las comparativas
   * traen solo el resumen, o null si ese mes no tiene informe.
   */
  getMensual(mes) {
    return api.get('/informes/mensual', { params: mes ? { mes } : {} }).then(r => r.data.data);
  },
};
