/**
 * utils/impersonacion.js
 * Guardar y recuperar la sesión del superadmin mientras ve la app como otro.
 *
 * Solo toca localStorage (sin llamadas a la API) para que lo puedan usar tanto
 * AuthContext como el interceptor de api.js sin importarse en círculo.
 *
 * Mientras dura la impersonación:
 *   accessToken  → el token impersonado (sin refreshToken: no se renueva)
 *   user         → el usuario impersonado
 *   imp:*        → la sesión del superadmin, intacta, para volver a ella
 *   impersonacion → { id, username, nombre, apellidos, expira } para la franja
 *
 * El cambio de identidad se hace SIEMPRE con recarga completa y vaciando las
 * cachés del service worker: los contextos (features, notificaciones…) y la
 * api-cache de Workbox están indexados por URL, no por usuario, y sin recargar
 * se mezclarían los datos de uno con la pantalla del otro.
 */

import { getItem, setItem, removeItem } from './sessionStorage.js';
import { vaciarCachesDeSesion } from './cachesSesion.js';

const CLAVES_SESION = ['accessToken', 'refreshToken', 'user'];

/** Datos de la impersonación en curso, o null. */
export function impersonacionActiva() {
  const raw = getItem('impersonacion');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Aparta la sesión propia y entra con la del usuario impersonado. */
export function guardarYEntrarComo({ accessToken, user, expiraEnMin }) {
  CLAVES_SESION.forEach((k) => {
    const v = getItem(k);
    if (v !== null) setItem(`imp:${k}`, v);
  });
  removeItem('refreshToken');
  setItem('accessToken', accessToken);
  setItem('user', JSON.stringify(user));
  setItem('impersonacion', JSON.stringify({
    id:        user.id,
    username:  user.username,
    nombre:    user.nombre,
    apellidos: user.apellidos,
    expira:    Date.now() + expiraEnMin * 60 * 1000,
  }));
}

/**
 * Deja la sesión del superadmin como estaba antes de impersonar.
 * @returns {boolean} si había algo que restaurar
 */
export function restaurarSesionPropia() {
  if (getItem('imp:accessToken') === null) {
    removeItem('impersonacion');
    return false;
  }
  CLAVES_SESION.forEach((k) => {
    const v = getItem(`imp:${k}`);
    if (v !== null) setItem(k, v); else removeItem(k);
    removeItem(`imp:${k}`);
  });
  removeItem('impersonacion');
  return true;
}

/** Recarga la app entera en `ruta`, sin datos cacheados de la otra identidad. */
export async function recargarComoOtraIdentidad(ruta) {
  await vaciarCachesDeSesion();
  window.location.href = `${import.meta.env.BASE_URL}${ruta.replace(/^\//, '')}`;
}
