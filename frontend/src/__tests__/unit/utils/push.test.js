import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  base64UrlABytes, soportaPush, estaInstalada, esIOS,
  permisoActual, suscripcionActual, suscribir, desuscribir,
} from '../../../utils/push.js';

/**
 * Tests de utils/push.js — lo que este módulo le pregunta al navegador.
 *
 * jsdom no trae Push API ni Notification, así que se montan a mano. Todo lo
 * que se toca de `window`/`navigator` se deshace en afterEach: si se queda
 * puesto, contamina los tests de los demás ficheros.
 */

const originales = {};

function definir(obj, prop, valor) {
  const clave = `${obj === window ? 'window' : 'navigator'}.${prop}`;
  if (!(clave in originales)) {
    originales[clave] = Object.getOwnPropertyDescriptor(obj, prop);
  }
  Object.defineProperty(obj, prop, { value: valor, configurable: true, writable: true });
}

function borrar(obj, prop) {
  const clave = `${obj === window ? 'window' : 'navigator'}.${prop}`;
  if (!(clave in originales)) {
    originales[clave] = Object.getOwnPropertyDescriptor(obj, prop);
  }
  delete obj[prop];
}

afterEach(() => {
  for (const [clave, descriptor] of Object.entries(originales)) {
    const [donde, prop] = clave.split('.');
    const obj = donde === 'window' ? window : navigator;
    if (descriptor) Object.defineProperty(obj, prop, descriptor);
    else delete obj[prop];
    delete originales[clave];
  }
  vi.restoreAllMocks();
});

/** Deja el navegador con todo lo que hace falta para hacer push. */
function navegadorConPush({ suscripcion = null, permiso = 'default' } = {}) {
  const registro = {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(suscripcion),
      subscribe:       vi.fn().mockResolvedValue({ endpoint: 'https://push.example/nueva' }),
    },
  };
  definir(navigator, 'serviceWorker', { ready: Promise.resolve(registro) });
  definir(window, 'PushManager', function PushManager() {});
  definir(window, 'Notification', {
    permission: permiso,
    requestPermission: vi.fn().mockResolvedValue('granted'),
  });
  return registro;
}

describe('base64UrlABytes', () => {
  it('convierte base64url a bytes, con su relleno', () => {
    // 'Zm9v' es 'foo' en base64 y no necesita relleno.
    expect(Array.from(base64UrlABytes('Zm9v'))).toEqual([102, 111, 111]);
  });

  it('repone el relleno que base64url se come', () => {
    // 'Zm8' son 3 caracteres: sin reponer el '=' final, atob lanza.
    expect(Array.from(base64UrlABytes('Zm8'))).toEqual([102, 111]);
  });

  it('traduce el alfabeto de base64url (-_ en vez de +/)', () => {
    const conGuiones = base64UrlABytes('-_8');
    const conMasBarra = base64UrlABytes('+/8');
    expect(Array.from(conGuiones)).toEqual(Array.from(conMasBarra));
  });

  it('devuelve un Uint8Array, que es lo que pide pushManager.subscribe', () => {
    expect(base64UrlABytes('Zm9v')).toBeInstanceOf(Uint8Array);
  });
});

describe('soportaPush', () => {
  it('true con serviceWorker, PushManager y Notification', () => {
    navegadorConPush();
    expect(soportaPush()).toBe(true);
  });

  it('false si falta PushManager (el caso del iPhone en Safari)', () => {
    navegadorConPush();
    borrar(window, 'PushManager');
    expect(soportaPush()).toBe(false);
  });

  it('false si no hay service worker', () => {
    navegadorConPush();
    borrar(navigator, 'serviceWorker');
    expect(soportaPush()).toBe(false);
  });

  it('false si no hay Notification', () => {
    navegadorConPush();
    borrar(window, 'Notification');
    expect(soportaPush()).toBe(false);
  });
});

describe('estaInstalada', () => {
  it('true cuando el display-mode es standalone', () => {
    definir(window, 'matchMedia', vi.fn().mockReturnValue({ matches: true }));
    expect(estaInstalada()).toBe(true);
  });

  it('true con el navigator.standalone de iOS', () => {
    definir(window, 'matchMedia', vi.fn().mockReturnValue({ matches: false }));
    definir(navigator, 'standalone', true);
    expect(estaInstalada()).toBe(true);
  });

  it('false en una pestaña normal', () => {
    definir(window, 'matchMedia', vi.fn().mockReturnValue({ matches: false }));
    definir(navigator, 'standalone', false);
    expect(estaInstalada()).toBe(false);
  });
});

describe('esIOS', () => {
  it('reconoce un iPhone por el user agent', () => {
    definir(navigator, 'userAgent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)');
    expect(esIOS()).toBe(true);
  });

  it('reconoce un iPad moderno, que se anuncia como Mac', () => {
    // Un Mac no tiene pantalla táctil: 'MacIntel' + maxTouchPoints > 1 es iPad.
    definir(navigator, 'userAgent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    definir(navigator, 'platform', 'MacIntel');
    definir(navigator, 'maxTouchPoints', 5);
    expect(esIOS()).toBe(true);
  });

  it('un Mac de verdad no es iOS', () => {
    definir(navigator, 'userAgent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    definir(navigator, 'platform', 'MacIntel');
    definir(navigator, 'maxTouchPoints', 0);
    expect(esIOS()).toBe(false);
  });

  it('Android no es iOS', () => {
    definir(navigator, 'userAgent', 'Mozilla/5.0 (Linux; Android 14)');
    definir(navigator, 'platform', 'Linux armv8l');
    definir(navigator, 'maxTouchPoints', 5);
    expect(esIOS()).toBe(false);
  });
});

describe('permisoActual', () => {
  it('devuelve lo que diga Notification.permission', () => {
    navegadorConPush({ permiso: 'granted' });
    expect(permisoActual()).toBe('granted');
  });

  it('sin Notification lo trata como denegado', () => {
    navegadorConPush();
    borrar(window, 'Notification');
    expect(permisoActual()).toBe('denied');
  });
});

describe('suscripcionActual', () => {
  it('devuelve la suscripción que ya tuviera el navegador', async () => {
    const previa = { endpoint: 'https://push.example/previa' };
    navegadorConPush({ suscripcion: previa });
    await expect(suscripcionActual()).resolves.toBe(previa);
  });

  it('null si el navegador no admite push', async () => {
    navegadorConPush();
    borrar(window, 'PushManager');
    await expect(suscripcionActual()).resolves.toBeNull();
  });
});

describe('suscribir', () => {
  it('pide permiso y crea la suscripción con la clave VAPID', async () => {
    const registro = navegadorConPush();

    const sub = await suscribir('Zm9v');

    expect(window.Notification.requestPermission).toHaveBeenCalled();
    expect(registro.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    });
    expect(sub).toEqual({ endpoint: 'https://push.example/nueva' });
  });

  it('retira una suscripción anterior antes de crear la nueva', async () => {
    // Una suscripción hecha con otra clave VAPID (p. ej. la de PRE) hace que
    // subscribe falle con InvalidStateError. Por eso se deshace primero.
    const previa = { endpoint: 'vieja', unsubscribe: vi.fn().mockResolvedValue(true) };
    const registro = navegadorConPush({ suscripcion: previa });

    await suscribir('Zm9v');

    expect(previa.unsubscribe).toHaveBeenCalled();
    expect(registro.pushManager.subscribe).toHaveBeenCalled();
  });

  it('si el usuario deniega el permiso, no se suscribe', async () => {
    const registro = navegadorConPush();
    window.Notification.requestPermission.mockResolvedValue('denied');

    await expect(suscribir('Zm9v')).rejects.toThrow(/permiso/i);
    expect(registro.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('sin clave pública no llega a pedir permiso', async () => {
    navegadorConPush();
    await expect(suscribir(null)).rejects.toThrow(/no tiene configurados/i);
    expect(window.Notification.requestPermission).not.toHaveBeenCalled();
  });

  it('en un navegador sin push lo dice claro', async () => {
    navegadorConPush();
    borrar(window, 'PushManager');
    await expect(suscribir('Zm9v')).rejects.toThrow(/no admite avisos push/i);
  });
});

describe('desuscribir', () => {
  it('retira la suscripción y devuelve su endpoint para darla de baja', async () => {
    const previa = {
      endpoint: 'https://push.example/previa',
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    navegadorConPush({ suscripcion: previa });

    await expect(desuscribir()).resolves.toBe('https://push.example/previa');
    expect(previa.unsubscribe).toHaveBeenCalled();
  });

  it('null si no había nada que retirar', async () => {
    navegadorConPush({ suscripcion: null });
    await expect(desuscribir()).resolves.toBeNull();
  });

  it('devuelve el endpoint aunque unsubscribe falle: el servidor la borra igual', async () => {
    const previa = {
      endpoint: 'https://push.example/previa',
      unsubscribe: vi.fn().mockRejectedValue(new Error('no se pudo')),
    };
    navegadorConPush({ suscripcion: previa });

    await expect(desuscribir()).resolves.toBe('https://push.example/previa');
  });
});
