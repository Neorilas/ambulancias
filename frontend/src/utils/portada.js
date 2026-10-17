/**
 * utils/portada.js
 * La pantalla en la que se aterriza al entrar en la app (`/`, PortadaInicio en
 * App.jsx). Es el único sitio que lo decide: el login sin destino, el `*` y
 * los rebotes de ProtectedRoute acaban todos aquí.
 */
import { ROLES } from './constants.js';

/**
 * - Administración (administrador o superadmin) → «Trabajos», el listado que
 *   gestionan, si pueden abrirlo. Manda el rol de gestión aunque lleve además
 *   `tecnico` (los roles no son excluyentes).
 * - El resto → «Mis trabajos» en cuanto el flag esté encendido para todos (D7
 *   del trabajo padre); hasta entonces, «Mis asignaciones».
 *
 * `isFeatureEnabled` (que al superadmin le dice que sí a todo) solo decide si
 * se puede abrir `/trabajos`: si se mandara allí a quien ProtectedRoute no deja
 * pasar, lo rebotaría a `/` y de vuelta aquí, en bucle. Para «Mis trabajos» se
 * mira la lista REAL de flags, que si no al superadmin le cambiaría la portada
 * antes que a nadie.
 */
export function rutaPortada({ hasRole, isFeatureEnabled, features = [] }) {
  const esAdministracion = hasRole(ROLES.ADMINISTRADOR) || hasRole(ROLES.SUPERADMIN);
  if (esAdministracion && isFeatureEnabled('menu_trabajos')) return '/trabajos';
  return features.includes('menu_mis_trabajos') ? '/mis-trabajos' : '/mis-asignaciones';
}
