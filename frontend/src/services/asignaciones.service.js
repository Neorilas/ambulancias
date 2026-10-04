import api from './api.js';
import { conReintentos, SUBIDA_FOTO_TIMEOUT_MS } from '../utils/subidaFotos.js';

export const asignacionesService = {
  list(params = {}) {
    return api.get('/asignaciones', { params }).then(r => r.data);
  },
  /** Asignaciones con la alarma de «sin iniciar» sonando (solo gestión). */
  alarmas() {
    return api.get('/asignaciones/alarmas').then(r => r.data.data);
  },
  get(id) {
    return api.get(`/asignaciones/${id}`).then(r => r.data.data);
  },
  create(data) {
    return api.post('/asignaciones', data).then(r => r.data.data);
  },
  update(id, data) {
    return api.put(`/asignaciones/${id}`, data).then(r => r.data.data);
  },
  delete(id) {
    return api.delete(`/asignaciones/${id}`).then(r => r.data);
  },
  activar(id) {
    return api.post(`/asignaciones/${id}/activar`).then(r => r.data.data);
  },
  registrarLlegada(id) {
    return api.post(`/asignaciones/${id}/llegada`).then(r => r.data.data);
  },
  // motivo_fin solo hace falta si termina antes de fecha_fin.
  registrarFinServicio(id, motivoFin = null) {
    return api.post(`/asignaciones/${id}/fin-servicio`, { motivo_fin: motivoFin }).then(r => r.data.data);
  },
  finalizar(id, data) {
    return api.post(`/asignaciones/${id}/finalizar`, data).then(r => r.data.data);
  },
  uploadEvidencia(id, formData) {
    // Timeout largo y reintentos ante fallos de red: ver utils/subidaFotos.js
    return conReintentos(() => api.post(`/asignaciones/${id}/evidencias`, formData, {
      headers: { 'Content-Type': undefined },
      timeout: SUBIDA_FOTO_TIMEOUT_MS,
    })).then(r => r.data.data);
  },
  crearIncidencia(id, data) {
    return api.post(`/asignaciones/${id}/incidencias`, data).then(r => r.data.data);
  },
};
