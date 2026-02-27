import api from './api.js';

export const authService = {
  async login(username, password) {
    const { data } = await api.post('/auth/login', { username, password });
    return data.data; // { accessToken, refreshToken, user }
  },

  async refresh(refreshToken) {
    const { data } = await api.post('/auth/refresh', { refreshToken });
    return data.data;
  },

  async logout(refreshToken) {
    try {
      await api.post('/auth/logout', { refreshToken });
    } catch { /* ignora errores en logout */ }
  },

  async me() {
    const { data } = await api.get('/auth/me');
    return data.data;
  },
};
