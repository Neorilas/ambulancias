/**
 * services/api.js
 * Instancia de Axios con interceptores JWT y refresh automático
 */

import axios from 'axios';
import { getItem, setItem, removeItem } from '../utils/sessionStorage.js';

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// ── Request interceptor: añadir Authorization header ──────────────────────
api.interceptors.request.use(
  (config) => {
    const token = getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (err) => Promise.reject(err)
);

// ── Response interceptor: refresh automático en 401 ──────────────────────
let isRefreshing    = false;
let failedQueue     = [];

function processQueue(error, token = null) {
  failedQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve(token)
  );
  failedQueue = [];
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const originalRequest = error.config;

    // Si es 401 y no es el propio endpoint de refresh → intentar refresh
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.url?.includes('/auth/refresh') &&
      !originalRequest.url?.includes('/auth/login')
    ) {
      const refreshToken = getItem('refreshToken');
      if (!refreshToken) {
        // Sin refresh token → limpiar sesión y redirigir a login
        clearAuth();
        return Promise.reject(error);
      }

      if (isRefreshing) {
        // Encolar mientras se refresca
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return api(originalRequest);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const { data } = await axios.post(`${API_BASE}/auth/refresh`, { refreshToken });
        const { accessToken, refreshToken: newRefresh } = data.data;

        setItem('accessToken',  accessToken);
        setItem('refreshToken', newRefresh);

        api.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
        originalRequest.headers.Authorization     = `Bearer ${accessToken}`;

        processQueue(null, accessToken);
        return api(originalRequest);

      } catch (refreshErr) {
        processQueue(refreshErr, null);
        clearAuth();
        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

function clearAuth() {
  removeItem('accessToken');
  removeItem('refreshToken');
  removeItem('user');
  // Redirigir a login sin causar loop
  if (!window.location.pathname.includes('/login')) {
    window.location.href = `${import.meta.env.BASE_URL}login`;
  }
}

export default api;
