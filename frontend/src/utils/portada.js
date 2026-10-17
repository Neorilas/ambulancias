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
 *   del trabajo padre); si no, «Mis asignaciones».
 * - Si tampoco esa está encendida, «Mi perfil», que no lleva flag.
 *
 * Solo se devuelve una pantalla que ProtectedRoute deje pasar a ese usuario:
 * si no, la guardia lo rebota a `/` y de vuelta aquí, en bucle. Por eso
 * «Trabajos» y «Mis asignaciones» se miran con `isFeatureEnabled`, el mismo
 * criterio que la guardia. «Mis trabajos» se mira en la lista REAL de flags
 * (que si no al superadmin le cambiaría la portada antes que a nadie); lo que
 * está en la lista también lo deja pasar la guardia.
 */
export function rutaPortada({ hasRole, isFeatureEnabled, features = [] }) {
  const esAdministracion = hasRole(ROLES.ADMINISTRADOR) || hasRole(ROLES.SUPERADMIN);
  if (esAdministracion && isFeatureEnabled('menu_trabajos')) return '/trabajos';
  if (features.includes('menu_mis_trabajos')) return '/mis-trabajos';
  if (isFeatureEnabled('menu_mis_asignaciones')) return '/mis-asignaciones';
  return '/perfil';
}
