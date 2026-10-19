import api from './api.js';

/**
 * services/flota.service.js
 * Mapa de la flota. El navegador NUNCA habla con Cartrack: pide aquí y las
 * credenciales se quedan en el backend (ver `backend/services/cartrack.service`).
 *
 * Solo superadmin: cualquier otro se lleva un 403 del backend.
 */
export const flotaService = {
  /**
   * Flota ya cruzada con el GPS.
   * Devuelve `{ flota, resumen, fuente, minutosSinSenal }`; `fuente` dice si el
   * dato es de ahora, de la caché o si Cartrack no contesta, para que la
   * pantalla pueda ser honesta con quien la mira.
   */
  getUbicaciones() {
    return api.get('/flota/ubicaciones').then(r => r.data.data);
  },

  /**
   * Ruta de un servicio según Cartrack. Devuelve
   * `{ estado, ventana, recorrido: { tramos, inicio, fin, km, puntos }, fuente }`;
   * `estado` es `ok`, `sin_empezar` o `sin_gps`.
   */
  getRecorrido(asignacionId) {
    return api.get(`/flota/recorrido/${asignacionId}`).then(r => r.data.data);
  },
};
