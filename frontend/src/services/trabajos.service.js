import api from './api.js';
import { conReintentos, SUBIDA_FOTO_TIMEOUT_MS } from '../utils/subidaFotos.js';

/**
 * Trabajos (v33, el trabajo padre): sus ambulancias son asignaciones y se
 * operan con `asignaciones.service` (activar, fotos, llegada, finalizar). Aquí
 * queda lo del trabajo: datos, coordinador, quién ve qué y el cierre.
 *
 * Y, hasta la fase 6 del plan, el ciclo por vehículo del modelo v25, para que
 * los trabajos antiguos a medias se puedan terminar (`TrabajoV25`).
 */
export const trabajosService = {
  list(params = {}) {
    return api.get('/trabajos', { params }).then(r => r.data);
  },
  listCalendario(params = {}) {
    return api.get('/trabajos/calendario', { params }).then(r => r.data.data);
  },
  misTrab(params = {}) {
    return api.get('/trabajos/mis-trabajos', { params }).then(r => r.data);
  },
  /** Lo suyo del mes (`year`, `month`), también lo cerrado: utils/calendario.js */
  miCalendario(params = {}) {
    return api.get('/trabajos/mi-calendario', { params }).then(r => r.data.data);
  },
  get(id) {
    return api.get(`/trabajos/${id}`).then(r => r.data.data);
  },
  /** El trabajo con su coordinador y al menos una ambulancia (`asignaciones`). */
  create(data) {
    return api.post('/trabajos', data).then(r => r.data.data);
  },
  update(id, data) {
    return api.put(`/trabajos/${id}`, data).then(r => r.data.data);
  },
  delete(id) {
    return api.delete(`/trabajos/${id}`).then(r => r.data);
  },
  /** Lo cierra su coordinador (o gestión) con todas sus ambulancias finalizadas. */
  cerrar(id) {
    return api.post(`/trabajos/${id}/cerrar`).then(r => r.data.data);
  },

  // ── Modelo v25 (convive hasta la fase 6) ──────────────────────
  // Ciclo de vida por vehículo: cada responsable activa y cierra el suyo
  activarVehiculo(id, vehicleId) {
    return api.post(`/trabajos/${id}/vehiculos/${vehicleId}/activar`).then(r => r.data.data);
  },
  finalizeVehiculo(id, vehicleId, data) {
    return api.post(`/trabajos/${id}/vehiculos/${vehicleId}/finalize`, data).then(r => r.data);
  },
  // Solo trabajos v25 SIN vehículos (los lleva gestión a mano)
  activar(id) {
    return api.post(`/trabajos/${id}/activar`).then(r => r.data.data);
  },
  finalize(id, data) {
    return api.post(`/trabajos/${id}/finalize`, data).then(r => r.data);
  },
  uploadEvidencia(id, formData) {
    // Eliminar el Content-Type por defecto (application/json) para que el
    // browser lo genere automáticamente con el boundary de multipart/form-data
    // Timeout largo y reintentos ante fallos de red: ver utils/subidaFotos.js
    return conReintentos(() => api.post(`/trabajos/${id}/evidencias`, formData, {
      headers: { 'Content-Type': undefined },
      timeout: SUBIDA_FOTO_TIMEOUT_MS,
    })).then(r => r.data.data);
  },
};
