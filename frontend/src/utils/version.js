/**
 * utils/version.js
 * Versión de la app (la de frontend/package.json), que vite.config.js inyecta
 * en el build. Cómo se sube: CLAUDE.md → «Versión».
 *
 * Fuera de Vite (los tests usan vitest.config.js, sin `define`) la constante
 * no existe, y de ahí el `typeof`: una referencia directa lanzaría.
 */
/* global __APP_VERSION__ */
export const VERSION_APP =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'desarrollo';
