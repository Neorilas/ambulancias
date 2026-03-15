import api from './api.js';

export const adminService = {
  getStats() {
    return api.get('/admin/stats').then(r => r.data.data);
  },
  listAudit(params = {}) {
    return api.get('/admin/audit', { params }).then(r => r.data);
  },
  listErrors(params = {}) {
    return api.get('/admin/errors', { params }).then(r => r.data);
  },
};
