import api from './api.js';

export const featuresService = {
  getActive() {
    return api.get('/features/active').then(r => r.data.data);
  },
  listAll() {
    return api.get('/features').then(r => r.data.data);
  },
  toggle(key, enabled) {
    return api.put(`/features/${key}`, { enabled }).then(r => r.data.data);
  },
};
