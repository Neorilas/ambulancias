/**
 * utils/push.js
 * Todo lo que hay que preguntarle al NAVEGADOR sobre los avisos push.
 *
 * La parte de servidor vive en `services/push.service.js`; aquí solo está lo
 * que depende del dispositivo: si lo soporta, si el usuario dio permiso y cómo
 * crear o deshacer la suscripción.
 */

/**
 * La clave VAPID viaja como base64url y `pushManager.subscribe` la quiere como
 * bytes. Base64url no es base64: cambia `-_` por `+/` y se come el relleno.
 */
export function base64UrlABytes(base64Url) {
  const relleno = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64  = (base64Url + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const binario = window.atob(base64);
  const bytes   = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** ¿Este navegador sabe hacer push? */
export function soportaPush() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager'   in window
    && 'Notification'  in window;
}

/** ¿La PWA está abierta como app instalada y no como pestaña del navegador? */
export function estaInstalada() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

/**
 * ¿Es un iPhone o un iPad?
 *
 * Importa porque iOS solo entrega push a las PWA añadidas a la pantalla de
 * inicio (desde iOS 16.4). En Safari a pelo no llega nada y hay que decírselo
 * al usuario, que si no se queda pulsando un botón que no hace nada.
 *
 * El iPad moderno se anuncia como Mac, así que no basta con mirar el userAgent:
 * un Mac con pantalla táctil no existe, luego `maxTouchPoints > 1` sobre
 * 'MacIntel' es un iPad.
 */
export function esIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/** 'default' | 'granted' | 'denied' — lo que el usuario ya haya respondido. */
export function permisoActual() {
  if (!('Notification' in window)) return 'denied';
  return Notification.permission;
}

/** Suscripción que este navegador ya tuviera, o null. */
export async function suscripcionActual() {
  if (!soportaPush()) return null;
  const registro = await navigator.serviceWorker.ready;
  return registro.pushManager.getSubscription();
}

/**
 * Pide permiso y crea la suscripción.
 *
 * `requestPermission` SOLO se llama desde aquí, y esto solo se invoca desde el
 * clic del usuario: un navegador moderno ignora (o penaliza) la petición de
 * permiso que no viene de un gesto.
 *
 * @throws {Error} con un mensaje ya escrito para enseñárselo al usuario
 */
export async function suscribir(clavePublica) {
  if (!soportaPush()) {
    throw new Error('Este navegador no admite avisos push.');
  }
  if (!clavePublica) {
    throw new Error('El servidor no tiene configurados los avisos push.');
  }

  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    throw new Error('No has concedido permiso para recibir avisos.');
  }

  const registro = await navigator.serviceWorker.ready;

  // Puede haber una suscripción vieja hecha con OTRA clave VAPID (por ejemplo
  // de cuando el dispositivo apuntaba a PRE). `subscribe` con una clave
  // distinta falla con InvalidStateError, así que se retira primero.
  const previa = await registro.pushManager.getSubscription();
  if (previa) await previa.unsubscribe().catch(() => { /* daba igual, se rehace */ });

  return registro.pushManager.subscribe({
    // Obligatorio en la práctica: los navegadores ya no aceptan false.
    userVisibleOnly:      true,
    applicationServerKey: base64UrlABytes(clavePublica),
  });
}

/** Retira la suscripción de este navegador. Devuelve el endpoint que tenía. */
export async function desuscribir() {
  const suscripcion = await suscripcionActual();
  if (!suscripcion) return null;
  const { endpoint } = suscripcion;
  await suscripcion.unsubscribe().catch(() => { /* el servidor la borra igual */ });
  return endpoint;
}
