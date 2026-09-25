/**
 * src/sw.js — Service Worker de la PWA.
 *
 * POR QUÉ EXISTE ESTE FICHERO
 * Hasta ahora el SW lo generaba `vite-plugin-pwa` solo (estrategia
 * `generateSW`) a partir de la configuración del `vite.config.js`. Los avisos
 * push necesitan un handler `push` y otro `notificationclick`, y eso no se
 * puede declarar en la configuración: hay que escribir el SW. Por eso se pasó
 * a `injectManifest`, donde el plugin ya solo inyecta la lista de ficheros a
 * precachear en `self.__WB_MANIFEST`.
 *
 * LO QUE HAY QUE MANTENER A MANO
 * Con `generateSW` el plugin añadía por su cuenta cuatro cosas que ahora son
 * responsabilidad de este fichero. Si se quitan, la PWA deja de actualizarse
 * sola o deja de funcionar sin cobertura:
 *   - `skipWaiting` + `clientsClaim` (los ponía por `registerType: 'autoUpdate'`),
 *   - el fallback de navegación a index.html (la SPA),
 *   - `cleanupOutdatedCaches`,
 *   - las dos reglas de `runtimeCaching`, portadas tal cual más abajo.
 */

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim } from 'workbox-core';
import { leerAviso, rutaDestino } from './utils/swAvisos.js';

// Carpeta donde vive la app: '/app/' en producción, '/app-pre/' en PRE, '/' en
// local. Se deduce de dónde se está sirviendo este propio fichero en vez de
// leerla de una variable de entorno, que es una cosa menos que pueda quedarse
// desincronizada con el `base` real del build.
const BASE = new URL('./', self.location).pathname;

// ============================================================
// Precaché y actualización
// ============================================================

// El plugin sustituye __WB_MANIFEST por la lista de ficheros del build.
precacheAndRoute(self.__WB_MANIFEST);

// Tira las cachés de versiones anteriores de Workbox.
cleanupOutdatedCaches();

// La app es una SPA: cualquier navegación se resuelve con index.html y el
// router de React decide qué pintar. Sin esto, abrir /app/asignaciones sin
// cobertura da un error de red.
registerRoute(new NavigationRoute(createHandlerBoundToURL(`${BASE}index.html`)));

// `registerType: 'autoUpdate'` da por hecho que el SW nuevo se activa solo.
// Con generateSW lo hacía el plugin; aquí hay que pedirlo explícitamente, y sin
// estas dos líneas los móviles se quedarían clavados en la versión vieja
// esperando a que se cierren todas las pestañas.
self.skipWaiting();
clientsClaim();

// Por si algún día se vuelve a `registerType: 'prompt'`: entonces el aviso de
// «hay versión nueva» manda este mensaje en vez de activarse solo.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ============================================================
// Caché en tiempo de ejecución (portada de la configuración anterior)
// ============================================================

// Listados que se consultan mucho y aguantan estar unos minutos viejos. Solo
// GET y nada sensible.
registerRoute(
  ({ url }) => /\/api\/v1\/(vehicles|trabajos\/calendario)/.test(url.pathname),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 300 })],
  })
);

// Las fotos subidas no cambian nunca: una vez en caché, se sirven de ahí.
registerRoute(
  ({ url }) => url.pathname.includes('/uploads/'),
  new CacheFirst({
    cacheName: 'images-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 7 * 24 * 60 * 60 })],
  })
);

// Detector de encuadre de las fotos (components/camera/detectorVehiculo.js):
// el chunk de TensorFlow, que va fuera del precache, y el modelo (7 MB). Los
// dos llevan versión en el nombre (hash del chunk, carpeta coco-ssd-vN), así
// que se pueden servir de caché para siempre; se bajan una vez por móvil.
registerRoute(
  ({ url }) => /\/assets\/deteccion-[^/]+\.js$/.test(url.pathname) || url.pathname.includes('/modelos/'),
  new CacheFirst({
    cacheName: 'deteccion-cache',
    plugins: [new ExpirationPlugin({ maxEntries: 10 })],
  })
);

// ============================================================
// Avisos push
// ============================================================

// `leerAviso` y `rutaDestino` viven en utils/swAvisos.js: son las dos piezas
// que más fácil se rompen y aquí dentro no habría forma de probarlas.

self.addEventListener('push', (event) => {
  const aviso = leerAviso(event.data);

  const opciones = {
    body:  aviso.cuerpo,
    icon:  `${BASE}icons/icon-192x192.png`,
    badge: `${BASE}icons/icon-96x96.png`,
    // El objetivo de todo esto es que el teléfono SUENE. `silent: false` pide
    // el sonido y la vibración por defecto del dispositivo; si el móvil está
    // en silencio o en «No molestar» no hay nada que Web Push pueda hacer.
    //
    // Lo que NO se puede hacer desde aquí, por mucho que se intente: elegir el
    // tono o subir el volumen. En Android eso lo decide el canal de
    // notificaciones del sistema, y una web no puede crear canales. Con la PWA
    // instalada, el canal es el de la propia app y se configura en los ajustes
    // del teléfono (ver docs/PLAN_NOTIFICACIONES_PUSH.md).
    silent:  false,
    // Patrón más largo que un pitido corto: con el móvil en el bolsillo, dos
    // vibraciones de 200 ms pasan desapercibidas.
    vibrate: [300, 150, 300, 150, 300],
    // En escritorio, el aviso se queda en pantalla hasta que alguien lo cierra
    // en vez de desvanecerse a los pocos segundos. En Android lo ignora Chrome
    // (allí los avisos web ya se quedan en la bandeja), pero no estorba.
    requireInteraction: true,
    data:    { url: aviso.url },
  };

  // `renotify` sin `tag` es un TypeError en Chrome, así que van juntos o no
  // van. Con ambos, un aviso nuevo del mismo suceso reemplaza al anterior en
  // la bandeja y vuelve a sonar, en vez de apilar duplicados.
  if (aviso.tag) {
    opciones.tag = aviso.tag;
    opciones.renotify = true;
  }

  event.waitUntil(Promise.all([
    self.registration.showNotification(aviso.titulo, opciones),
    // Con la app abierta, que `AlarmaSinIniciar` vuelva a preguntar ya en vez
    // de esperar a su ciclo de 30 s: la sirena arranca a la vez que el aviso.
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(ventanas => ventanas.forEach(v => v.postMessage({ type: 'AVISO_PUSH', tag: aviso.tag }))),
  ]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const destino = new URL(
    rutaDestino(BASE, event.notification.data?.url),
    self.location.origin
  ).href;

  event.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    // Si el admin ya tiene la app abierta se reutiliza esa ventana: abrir una
    // segunda pestaña de la misma PWA desconcierta más que ayuda.
    for (const cliente of abiertas) {
      if (!cliente.url.startsWith(self.registration.scope)) continue;
      await cliente.focus();
      if ('navigate' in cliente) {
        try { await cliente.navigate(destino); } catch { /* el foco ya es suficiente */ }
      }
      return;
    }

    await self.clients.openWindow(destino);
  })());
});
