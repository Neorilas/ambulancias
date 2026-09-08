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

    // 429: el servidor ha cortado por exceso de peticiones. No se reintenta
    // (volver a insistir sólo consume más cupo), pero se marca el error y se
    // deja un mensaje claro para que la pantalla no diga "Error al cargar".
    if (error.response?.status === 429) {
      error.esLimiteDePeticiones = true;
      const espera = Number(error.response.headers?.['retry-after']);
      if (error.response.data && typeof error.response.data === 'object' && Number.isFinite(espera)) {
        const minutos = Math.ceil(espera / 60);
        error.response.data.message =
          `${error.response.data.message || 'Demasiadas solicitudes.'} ` +
          `Vuelve a intentarlo en ${minutos <= 1 ? 'un minuto' : `${minutos} minutos`}.`;
      }
      return Promise.reject(error);
    }

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
        // Un 429 en el refresco no significa que la sesión sea inválida: el
        // token sigue siendo bueno y el siguiente intento lo renovará. Cerrar
        // sesión aquí echaba al técnico a la pantalla de login en mitad de un
        // servicio, y su relogin gastaba a su vez cupo del limitador de login.
        if (refreshErr.response?.status !== 429) clearAuth();
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
