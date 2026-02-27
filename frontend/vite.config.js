import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env  = loadEnv(mode, process.cwd(), '');
  const BASE = env.VITE_BASE_PATH || '/';

  return {
    base: BASE,
    plugins: [
      react(),
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
          name:             'VAPSS · Gestión Operaciones',
          short_name:       'VAPSS',
          description:      'Sistema interno de operaciones · V.A.P Servicios Sanitarios',
          theme_color:      '#1a9e44',
          background_color: '#ffffff',
          display:          'standalone',
          orientation:      'portrait-primary',
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
