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
import { reportarErrorDePeticion } from '../utils/reporteErrores.js';

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

// Una subida de foto no sale con un token a punto de caducar: se refresca
// antes. Incidente 2026-10-03 (asignación 83): el técnico tardó más de los
// 15 min del token en hacer las fotos; el backend contestó 401 al instante
// (`authenticate` va antes de multer y no lee el cuerpo), pero esa respuesta
// no llegó al móvil hasta agotar el timeout de la subida — 30 s antes
// («timeout of 30000ms exceeded»), 120 s ahora. Solo entonces se refrescaba y
// todo subía en un segundo. Las peticiones sin fichero no tienen el problema:
// su 401 llega al momento y el refresco del interceptor de respuesta basta.
export const MARGEN_CADUCIDAD_TOKEN_S = 60;

/**
 * true si el JWT caduca en menos de MARGEN_CADUCIDAD_TOKEN_S. Un token que no
 * se puede leer da false: mejor mandarlo y que el 401 haga su camino de
 * siempre que refrescar a ciegas. Con el reloj del móvil adelantado, como
 * mucho se refresca de más, una vez por subida.
 */
export function tokenCaducaPronto(token, ahoraMs = Date.now()) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number'
      && payload.exp * 1000 - ahoraMs < MARGEN_CADUCIDAD_TOKEN_S * 1000;
  } catch {
    return false;
  }
}

// ── Request interceptor: añadir Authorization header ──────────────────────
api.interceptors.request.use(
  (config) => {
    const token = getItem('accessToken');
    if (
      token && config.data instanceof FormData && tokenCaducaPronto(token)
      && getItem('refreshToken') && !impersonacionActiva()
    ) {
      // Si el refresco falla, la subida no sale: el error llega a quien subía
      // (sin respuesta → `conReintentos` lo repite; un 4xx ya ha cerrado sesión).
      return refrescar().then((nuevo) => {
        config.headers.Authorization = `Bearer ${nuevo}`;
        return config;
      });
    }
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (err) => Promise.reject(err)
);

// ── Refresco de la sesión (uno a la vez) ──────────────────────────────────
// Las peticiones que piden refresco mientras hay uno en vuelo esperan a ese.
let refrescoEnCurso = null;

function refrescar() {
  if (!refrescoEnCurso) {
    refrescoEnCurso = (async () => {
      const { data } = await axios.post(
        `${API_BASE}/auth/refresh`, { refreshToken: getItem('refreshToken') }, { timeout: REFRESH_TIMEOUT_MS },
      );
      const { accessToken, refreshToken: newRefresh } = data.data;
      setItem('accessToken',  accessToken);
      setItem('refreshToken', newRefresh);
      api.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
      return accessToken;
    })()
      .catch((refreshErr) => {
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
        throw refreshErr;
      })
      .finally(() => { refrescoEnCurso = null; });
  }
  return refrescoEnCurso;
}

// ── Response interceptor: refresh automático en 401 ──────────────────────

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

      if (!getItem('refreshToken')) {
        // Sin refresh token → limpiar sesión y redirigir a login
        clearAuth();
        return Promise.reject(error);
      }

      originalRequest._retry = true;
      const accessToken = await refrescar();
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return api(originalRequest);
    }

    // Sin respuesta o 502/503/504: el backend no lo ha visto, así que no está
    // en error_logs. Lo manda la app (utils/reporteErrores.js).
    reportarErrorDePeticion(error);
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
