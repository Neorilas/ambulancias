import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Sustituye los marcadores __BASE_PATH__ del .htaccess que Vite copia de
 * public/ a dist/.
 *
 * PRE y producción comparten hosting y se distinguen solo por la carpeta
 * (/app-pre/ y /app/). El .htaccess lleva esa ruta dentro dos veces
 * —RewriteBase y Service-Worker-Allowed— y si no coincide con la carpeta real
 * se rompen el fallback de la SPA y el alcance del service worker.
 *
 * Va como plugin y no como script de postbuild a propósito: aquí el valor de
 * `base` es el que Vite ha usado de verdad. Un script aparte tendría que
 * adivinarlo desde process.env, donde Vite no lo publica.
 */
function htaccessConBase(base) {
  return {
    name: 'htaccess-con-base',
    apply: 'build',
    closeBundle() {
      const destino = resolve(process.cwd(), 'dist', '.htaccess');
      if (!existsSync(destino)) {
        this.error('No se ha generado dist/.htaccess (¿sigue en public/?)');
      }
      const contenido = readFileSync(destino, 'utf8').replaceAll('__BASE_PATH__', base);
      if (contenido.includes('__BASE_PATH__')) {
        this.error('Han quedado marcadores __BASE_PATH__ sin sustituir');
      }
      writeFileSync(destino, contenido, 'utf8');
      this.info(`.htaccess generado para base "${base}"`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env  = loadEnv(mode, process.cwd(), '');
  const BASE    = env.VITE_BASE_PATH || '/';
  const APP_ENV = env.VITE_APP_ENV    || 'produccion';
  const ES_PRE  = APP_ENV === 'pre';

  // PRE y PRODUCCIÓN comparten el dominio vapss.net y se distinguen solo por
  // la carpeta (/app-pre/ y /app/). Cambiar el nombre y el color del manifest
  // hace que se instalen como dos apps distintas en el móvil del técnico y que
  // no haya forma de confundirlas.
  const NOMBRE      = ES_PRE ? 'VAPSS PRE · Operaciones' : 'VAPSS · Gestión Operaciones';
  const NOMBRE_CORT = ES_PRE ? 'VAPSS PRE'               : 'VAPSS';
  const COLOR_TEMA  = ES_PRE ? '#b45309'                 : '#2563eb';

  return {
    base: BASE,
    plugins: [
      react(),
      htaccessConBase(BASE),
      VitePWA({
        registerType:   'autoUpdate',
        includeAssets:  ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
        devOptions: {
          enabled: true,  // habilitar SW en desarrollo para testing
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          runtimeCaching: [
            {
              // Cache de la API (solo GET, sin datos sensibles)
              urlPattern: /^https?:\/\/.*\/api\/v1\/(vehicles|trabajos\/calendario)/,
              handler: 'NetworkFirst',
              options: {
                cacheName:          'api-cache',
                expiration:         { maxEntries: 50, maxAgeSeconds: 300 },
                networkTimeoutSeconds: 5,
              },
            },
            {
              // Cache de imágenes subidas
              urlPattern: /^https?:\/\/.*\/uploads\//,
              handler: 'CacheFirst',
              options: {
                cacheName:  'images-cache',
                expiration: { maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 },
              },
            },
          ],
        },
        manifest: {
          name:             NOMBRE,
          short_name:       NOMBRE_CORT,
          description:      'Sistema interno de operaciones · V.A.P Servicios Sanitarios',
          theme_color:      COLOR_TEMA,
          background_color: '#ffffff',
          display:          'standalone',
          orientation:      'any',
          start_url:        `${BASE}`,
          scope:            `${BASE}`,
          lang:             'es',
          categories:       ['medical', 'business'],
          icons: [
            { src: `${BASE}icons/icon-72x72.png`,   sizes: '72x72',   type: 'image/png' },
            { src: `${BASE}icons/icon-96x96.png`,   sizes: '96x96',   type: 'image/png' },
            { src: `${BASE}icons/icon-128x128.png`, sizes: '128x128', type: 'image/png' },
            { src: `${BASE}icons/icon-144x144.png`, sizes: '144x144', type: 'image/png' },
            { src: `${BASE}icons/icon-152x152.png`, sizes: '152x152', type: 'image/png' },
            { src: `${BASE}icons/icon-192x192.png`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
            { src: `${BASE}icons/icon-384x384.png`, sizes: '384x384', type: 'image/png' },
            { src: `${BASE}icons/icon-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
          shortcuts: [
            {
              name:       'Mis Trabajos',
              short_name: 'Mis Trabajos',
              url:        `${BASE}mis-trabajos`,
              icons:      [{ src: `${BASE}icons/icon-96x96.png`, sizes: '96x96' }],
            },
          ],
        },
      }),
    ],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target:    'http://localhost:3001',
          changeOrigin: true,
        },
        '/uploads': {
          target:    'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir:     'dist',
      sourcemap:  false,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor:    ['react', 'react-dom', 'react-router-dom'],
            utils:     ['axios', 'date-fns'],
          },
        },
      },
    },
  };
});
