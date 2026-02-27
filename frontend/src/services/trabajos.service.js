import api from './api.js';

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
  get(id) {
    return api.get(`/trabajos/${id}`).then(r => r.data.data);
  },
  create(data) {
    return api.post('/trabajos', data).then(r => r.data.data);
  },
  update(id, data) {
    return api.put(`/trabajos/${id}`, data).then(r => r.data.data);
  },
  delete(id) {
    return api.delete(`/trabajos/${id}`).then(r => r.data);
  },
  finalize(id, data) {
    return api.post(`/trabajos/${id}/finalize`, data).then(r => r.data.data);
  },
  uploadEvidencia(id, formData) {
    return api.post(`/trabajos/${id}/evidencias`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data.data);
  },
};
