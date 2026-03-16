import api from './api.js';

export const asignacionesService = {
  list(params = {}) {
    return api.get('/asignaciones', { params }).then(r => r.data);
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
  finalizar(id, data) {
    return api.post(`/asignaciones/${id}/finalizar`, data).then(r => r.data.data);
  },
  uploadEvidencia(id, formData) {
    return api.post(`/asignaciones/${id}/evidencias`, formData, {
      headers: { 'Content-Type': undefined },
    }).then(r => r.data.data);
  },
};
