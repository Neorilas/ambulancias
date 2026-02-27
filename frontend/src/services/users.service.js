import api from './api.js';

export const usersService = {
  list(params = {}) {
    return api.get('/users', { params }).then(r => r.data);
  },
  get(id) {
    return api.get(`/users/${id}`).then(r => r.data.data);
  },
  create(data) {
    return api.post('/users', data).then(r => r.data.data);
  },
  update(id, data) {
    return api.put(`/users/${id}`, data).then(r => r.data.data);
  },
  delete(id) {
    return api.delete(`/users/${id}`).then(r => r.data);
  },
  listRoles() {
    return api.get('/users/roles').then(r => r.data.data);
  },
  createRole(data) {
    return api.post('/users/roles', data).then(r => r.data.data);
  },
};
