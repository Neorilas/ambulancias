/**
 * Convierte una ruta relativa /uploads/... a la URL absoluta del backend.
 * En producción el backend está en api.vapss.net, separado del frontend.
 */
export function getImageUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;

  const apiUrl = import.meta.env.VITE_API_URL || '';
  // apiUrl es algo como https://api.vapss.net/api/v1
  // Necesitamos solo el origen: https://api.vapss.net
  const origin = apiUrl.replace(/\/api\/.*$/, '');
  return origin + path;
}
