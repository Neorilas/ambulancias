import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Auto-reload silencioso del Service Worker.
 *
 * - Cada 60 s comprueba si hay una nueva versión del SW.
 * - Cuando detecta una, llama a updateServiceWorker(true) que:
 *   1. Activa el nuevo SW inmediatamente (skipWaiting).
 *   2. Recarga la página para que el usuario vea los cambios.
 *
 * No renderiza nada — es invisible para el usuario.
 */
const SW_CHECK_INTERVAL = 60 * 1000; // 60 segundos

export default function SWUpdater() {
  const intervalRef = useRef(null);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      if (!registration) return;

      // Limpiar intervalo anterior por si acaso
      if (intervalRef.current) clearInterval(intervalRef.current);

      intervalRef.current = setInterval(async () => {
        if (!navigator.onLine) return;
        try {
          await registration.update();
        } catch {
          // Fallo silencioso — se reintentará en el próximo intervalo
        }
      }, SW_CHECK_INTERVAL);
    },
    onOfflineReady() {
      console.log('[SW] App lista para uso offline');
    },
  });

  // Cuando hay un SW nuevo esperando → activar y recargar
  useEffect(() => {
    if (needRefresh) {
      console.log('[SW] Nueva versión detectada — recargando...');
      updateServiceWorker(true);
    }
  }, [needRefresh, updateServiceWorker]);

  // Cleanup del intervalo
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return null; // No renderiza nada
}
