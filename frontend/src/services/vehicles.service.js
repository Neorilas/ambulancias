import api from './api.js';

export const vehiclesService = {
  list(params = {}) {
    return api.get('/vehicles', { params }).then(r => r.data);
  },
  get(id) {
    return api.get(`/vehicles/${id}`).then(r => r.data.data);
  },
  create(data) {
    return api.post('/vehicles', data).then(r => r.data.data);
  },
  update(id, data) {
    return api.put(`/vehicles/${id}`, data).then(r => r.data.data);
  },
  delete(id) {
    return api.delete(`/vehicles/${id}`).then(r => r.data);
  },
  getImages(id, params = {}) {
    return api.get(`/vehicles/${id}/images`, { params }).then(r => r.data.data);
  },
  uploadImage(id, formData) {
    return api.post(`/vehicles/${id}/images`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data.data);
  },
};
