import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * El módulo lee VITE_APP_ENV y ejecuta la migración de claves antiguas al
 * importarse, así que cada caso necesita una carga limpia: `resetModules` +
 * `stubEnv` antes del `import()`, nunca un import estático arriba.
 */
async function cargar(appEnv) {
  vi.resetModules();
  vi.stubEnv('VITE_APP_ENV', appEnv);
  return import('../../../utils/sessionStorage');
}

describe('sessionStorage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllEnvs());

  describe('PREFIJO', () => {
    it('producción también lleva prefijo, para que no haya caso especial', async () => {
      const { PREFIJO } = await cargar('produccion');
      expect(PREFIJO).toBe('vapss:produccion:');
    });

    it('PRE usa el suyo, distinto del de producción', async () => {
      const { PREFIJO } = await cargar('pre');
      expect(PREFIJO).toBe('vapss:pre:');
    });

    it('sin VITE_APP_ENV asume producción', async () => {
      vi.resetModules();
      vi.stubEnv('VITE_APP_ENV', '');
      const { PREFIJO } = await import('../../../utils/sessionStorage');
      expect(PREFIJO).toBe('vapss:produccion:');
    });
  });

  describe('get / set / remove', () => {
    it('escribe y lee bajo el prefijo del entorno', async () => {
      const { getItem, setItem } = await cargar('pre');
      setItem('accessToken', 'abc');
      expect(localStorage.getItem('vapss:pre:accessToken')).toBe('abc');
      expect(getItem('accessToken')).toBe('abc');
    });

    it('una clave que no existe devuelve null', async () => {
      const { getItem } = await cargar('produccion');
      expect(getItem('noExiste')).toBeNull();
    });

    it('no lee la clave suelta, sin prefijo', async () => {
      const { getItem } = await cargar('pre');
      localStorage.setItem('accessToken', 'suelto');
      expect(getItem('accessToken')).toBeNull();
    });

    it('PRE y PRODUCCIÓN no se pisan la sesión', async () => {
      const pre = await cargar('pre');
      pre.setItem('accessToken', 'token-pre');

      const pro = await cargar('produccion');
      pro.setItem('accessToken', 'token-pro');

      expect(localStorage.getItem('vapss:pre:accessToken')).toBe('token-pre');
      expect(localStorage.getItem('vapss:produccion:accessToken')).toBe('token-pro');
      expect(pro.getItem('accessToken')).toBe('token-pro');
    });

    it('removeItem borra solo la clave de su entorno', async () => {
      const { setItem, removeItem, getItem } = await cargar('produccion');
      setItem('accessToken', 'abc');
      localStorage.setItem('vapss:pre:accessToken', 'token-pre');

      removeItem('accessToken');

      expect(getItem('accessToken')).toBeNull();
      expect(localStorage.getItem('vapss:pre:accessToken')).toBe('token-pre');
    });
  });

  describe('clear', () => {
    it('borra las claves de este entorno y respeta las demás', async () => {
      const { setItem, clear, getItem } = await cargar('produccion');
      setItem('accessToken', 'abc');
      setItem('user', '{}');
      localStorage.setItem('vapss:pre:accessToken', 'token-pre');
      localStorage.setItem('tema', 'oscuro');

      clear();

      expect(getItem('accessToken')).toBeNull();
      expect(getItem('user')).toBeNull();
      expect(localStorage.getItem('vapss:pre:accessToken')).toBe('token-pre');
      expect(localStorage.getItem('tema')).toBe('oscuro');
    });

    it('con el storage vacío no falla', async () => {
      const { clear } = await cargar('pre');
      expect(() => clear()).not.toThrow();
    });
  });

  describe('migración de las claves antiguas', () => {
    it('producción rescata la sesión guardada sin prefijo', async () => {
      localStorage.setItem('accessToken', 'viejo-a');
      localStorage.setItem('refreshToken', 'viejo-r');
      localStorage.setItem('user', '{"id":1}');

      const { getItem } = await cargar('produccion');

      expect(getItem('accessToken')).toBe('viejo-a');
      expect(getItem('refreshToken')).toBe('viejo-r');
      expect(getItem('user')).toBe('{"id":1}');
      // La clave suelta se retira para no migrarla otra vez.
      expect(localStorage.getItem('accessToken')).toBeNull();
    });

    it('no pisa lo que ya estuviera con el prefijo nuevo', async () => {
      localStorage.setItem('accessToken', 'viejo');
      localStorage.setItem('vapss:produccion:accessToken', 'nuevo');

      const { getItem } = await cargar('produccion');

      expect(getItem('accessToken')).toBe('nuevo');
      expect(localStorage.getItem('accessToken')).toBeNull();
    });

    it('PRE no migra: ese token lo firmó otro secreto JWT', async () => {
      localStorage.setItem('accessToken', 'token-de-produccion');

      const { getItem } = await cargar('pre');

      expect(getItem('accessToken')).toBeNull();
      expect(localStorage.getItem('accessToken')).toBe('token-de-produccion');
    });

    it('solo migra las tres claves de sesión', async () => {
      localStorage.setItem('tema', 'oscuro');
      await cargar('produccion');
      expect(localStorage.getItem('tema')).toBe('oscuro');
      expect(localStorage.getItem('vapss:produccion:tema')).toBeNull();
    });
  });

  describe('storage bloqueado (modo privado, cuota llena)', () => {
    it('getItem devuelve null en vez de propagar el error', async () => {
      const { getItem } = await cargar('produccion');
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('bloqueado');
      });
      expect(getItem('accessToken')).toBeNull();
      spy.mockRestore();
    });

    it('setItem y removeItem no rompen la app', async () => {
      const { setItem, removeItem } = await cargar('produccion');
      const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('cuota llena');
      });
      expect(() => setItem('accessToken', 'abc')).not.toThrow();
      setSpy.mockRestore();

      const rmSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('bloqueado');
      });
      expect(() => removeItem('accessToken')).not.toThrow();
      rmSpy.mockRestore();
    });

    it('clear tampoco', async () => {
      const { clear } = await cargar('produccion');
      const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('bloqueado');
      });
      localStorage.setItem('vapss:produccion:user', '{}');
      expect(() => clear()).not.toThrow();
      spy.mockRestore();
    });

    it('la migración al importar tampoco tumba el arranque', async () => {
      localStorage.setItem('accessToken', 'viejo');
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('cuota llena');
      });
      await expect(cargar('produccion')).resolves.toBeDefined();
      spy.mockRestore();
    });
  });
});
