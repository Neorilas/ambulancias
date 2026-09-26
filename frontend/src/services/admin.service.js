import api from './api.js';

export const adminService = {
  getStats() {
    return api.get('/admin/stats').then(r => r.data.data);
  },
  listAudit(params = {}) {
    return api.get('/admin/audit', { params }).then(r => r.data);
  },
  listAuditUsers() {
    return api.get('/admin/audit/users').then(r => r.data.data);
  },
  listErrors(params = {}) {
    return api.get('/admin/errors', { params }).then(r => r.data);
  },
  /** { accessToken, expiraEnMin, user } para ver la app como ese usuario. */
  impersonar(userId) {
    return api.post(`/admin/impersonar/${userId}`).then(r => r.data.data);
  },
};
