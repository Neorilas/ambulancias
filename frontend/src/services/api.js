/**
 * services/api.js
 * Instancia de Axios con interceptores JWT y refresh automático
 */

import axios from 'axios';
import { getItem, setItem, removeItem } from '../utils/sessionStorage.js';
import { vaciarCachesDeSesion } from '../utils/cachesSesion.js';
import {
  impersonacionActiva, restaurarSesionPropia, recargarComoOtraIdentidad, descartarSesionApartada,
} from '../utils/impersonacion.js';

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

// El refresco va con axios «a pelo» (fuera de la instancia, para no pasar por
// su propio interceptor) y por eso no hereda el timeout de abajo. Sin uno
// propio, con mala cobertura se quedaba colgado para siempre: isRefreshing no
// volvía a false y toda petición posterior —el logout incluido— esperaba en
// la cola. La app entera se quedaba «cargando» (incidente 2026-09-27, 12:21).
export const REFRESH_TIMEOUT_MS = 15000;

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
      !originalRequest.url?.includes('/auth/login') &&
      // El logout no espera más de LOGOUT_ESPERA_MS: un refresco lanzado por
      // su 401 acabaría después y volvería a escribir tokens con la sesión ya
      // cerrada. Su error se ignora de todas formas (authService.logout).
      !originalRequest.url?.includes('/auth/logout')
    ) {
      // El /fin con el token ya caducado (lo normal cuando la franja vuelve
      // sola al agotarse el tiempo) no se toca aquí: ni restaurar ni el
      // clearAuth de abajo, que mandaría a /login a la vez que AuthContext
      // restaura y recarga — dos navegaciones compitiendo.
      if (originalRequest.url?.includes('/auth/impersonacion/fin')) {
        return Promise.reject(error);
      }

      // Impersonando no hay refresh: un 401 es que el token impersonado ha
      // caducado (o el superadmin ha perdido el rol). Se vuelve a la sesión
      // propia en vez de echar al login.
      if (impersonacionActiva()) {
        restaurarSesionPropia();
        recargarComoOtraIdentidad('/usuarios');
        return Promise.reject(error);
      }

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
        const { data } = await axios.post(
          `${API_BASE}/auth/refresh`, { refreshToken }, { timeout: REFRESH_TIMEOUT_MS },
        );
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
        // Tampoco cuando el refresco se ha quedado sin respuesta (timeout, sin
        // red) o el servidor ha fallado (un 502 durante un deploy): eso no dice
        // nada de la sesión, y echar al login a quien está sin cobertura le
        // obliga a teclear la contraseña al recuperarla. Solo un rechazo real
        // del servidor (4xx) cierra la sesión.
        const status = refreshErr.response?.status;
        if (status >= 400 && status < 500 && status !== 429) clearAuth();
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
  // Red de seguridad: si se llega aquí con una impersonación a medias, que no
  // quede el refresh token del superadmin apartado en imp:* sin nadie que lo use.
  descartarSesionApartada();
  vaciarCachesDeSesion();
  // Redirigir a login sin causar loop
  if (!window.location.pathname.includes('/login')) {
    window.location.href = `${import.meta.env.BASE_URL}login`;
  }
}

export default api;
