'use strict';

/**
 * Tests de services/push.service.js
 *
 * `web-push` va mockeado: aquí no sale ni una petición a FCM/APNs. Lo que se
 * comprueba es lo que decide este módulo — a quién se avisa, qué se hace con
 * una suscripción caducada y que nada de esto pueda lanzar hacia arriba.
 *
 * Ojo con el orden de carga: el módulo lee las claves VAPID al importarse, así
 * que cada bloque fija `process.env` y llama a `jest.resetModules()` ANTES de
 * su `require`. Por eso no hay un require en la cabecera del fichero.
 */

// El objeto del mock se declara fuera y la factoría lo DEVUELVE tal cual, en
// vez de construir uno nuevo. Con `jest.resetModules()` la factoría se vuelve a
// ejecutar, y una que devolviera `{ sendNotification: jest.fn() }` daría un
// mock distinto en cada carga: las aserciones de este fichero mirarían a un
// espía que el módulo ya no usa. El prefijo `mock` del nombre es lo que permite
// referenciarlo desde la factoría, que jest iza por encima de los `const`.
const mockWebPush = {
  setVapidDetails:  jest.fn(),
  sendNotification: jest.fn(),
};
jest.mock('web-push', () => mockWebPush);

const webpush = mockWebPush;

const CLAVE_PUBLICA = 'BOhPFAiZ_clave_publica_de_prueba';
const CLAVE_PRIVADA = 'clave_privada_de_prueba';

// `jest.resetModules()` reconstruye también el mock de config/database, así que
// el `query` que usa el módulo recién cargado NO es el mismo objeto que el de
// un require anterior. Se reasigna en cada carga; capturarlo una sola vez en la
// cabecera del fichero deja todas las aserciones mirando a un mock huérfano.
let query;

/** Carga el módulo con (o sin) claves VAPID en el entorno. */
function cargarPush({ conClaves = true } = {}) {
  jest.resetModules();
  if (conClaves) {
    process.env.VAPID_PUBLIC_KEY  = CLAVE_PUBLICA;
    process.env.VAPID_PRIVATE_KEY = CLAVE_PRIVADA;
  } else {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  }
  const push = require('../../../services/push.service');
  ({ query } = require('../../../config/database'));
  return push;
}

/** Error tal y como lo lanza web-push: con `statusCode`. */
function errorPush(statusCode) {
  const err = new Error(`push ${statusCode}`);
  err.statusCode = statusCode;
  return err;
}

const SUSCRIPCION = (id, userId = 9) => ({
  id, user_id: userId, endpoint: `https://push.example/${id}`,
  p256dh: 'p256dh', auth: 'auth',
});

describe('push.service', () => {
  beforeEach(() => {
    // El mock de `query` nace limpio en cada cargarPush(); el de web-push no,
    // porque 'web-push' se mockea una sola vez para todo el fichero.
    webpush.sendNotification.mockReset();
    webpush.setVapidDetails.mockReset();
  });

  // ── Configuración ────────────────────────────────────────
  describe('configuración VAPID', () => {
    it('queda configurado cuando hay claves en el entorno', () => {
      const push = cargarPush();
      expect(push.estaConfigurado()).toBe(true);
      expect(push.clavePublica()).toBe(CLAVE_PUBLICA);
      expect(webpush.setVapidDetails).toHaveBeenCalled();
    });

    it('sin claves queda inerte y no expone clave pública', () => {
      const push = cargarPush({ conClaves: false });
      expect(push.estaConfigurado()).toBe(false);
      expect(push.clavePublica()).toBeNull();
      expect(webpush.setVapidDetails).not.toHaveBeenCalled();
    });

    it('sin claves, notificarAdmins no consulta la BD ni envía nada', async () => {
      const push = cargarPush({ conClaves: false });
      const res = await push.notificarAdmins({ titulo: 'x', cuerpo: 'y' });
      expect(res).toMatchObject({ enviados: 0, omitido: 'sin-claves-vapid' });
      expect(query).not.toHaveBeenCalled();
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });

    it('con claves inválidas se apaga en vez de reventar en cada envío', async () => {
      webpush.setVapidDetails.mockImplementation(() => { throw new Error('clave mal formada'); });
      const push = cargarPush();
      expect(push.estaConfigurado()).toBe(false);
      expect(push.clavePublica()).toBeNull();
      const res = await push.notificarAdmins({ titulo: 'x', cuerpo: 'y' });
      expect(res.omitido).toBe('sin-claves-vapid');
    });
  });

  // ── Destinatarios ────────────────────────────────────────
  describe('suscripcionesDeAdmins', () => {
    it('filtra por permiso manage_trabajos o rol de mando, y solo usuarios activos', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([[SUSCRIPCION(1)]]);

      await push.suscripcionesDeAdmins();

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/manage_trabajos|p\.nombre = \?/);
      expect(sql).toMatch(/u\.activo = 1/);
      expect(sql).toMatch(/u\.deleted_at IS NULL/);
      expect(params.slice(0, 3)).toEqual(['manage_trabajos', 'administrador', 'superadmin']);
    });

    it('excluye al responsable de la asignación', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([[]]);

      await push.suscripcionesDeAdmins(7);

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/ps\.user_id <> \?/);
      expect(params[3]).toBe(7);
      expect(params[4]).toBe(7);
    });

    it('sin nadie a quien excluir manda NULL, que deja pasar a todos', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([[]]);

      await push.suscripcionesDeAdmins();

      const params = query.mock.calls[0][1];
      expect(params[3]).toBeNull();
      expect(params[4]).toBeNull();
    });
  });

  // ── Envío ────────────────────────────────────────────────
  describe('notificarAdmins', () => {
    it('manda un aviso a cada suscripción y sella last_ok_at', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([[SUSCRIPCION(1, 9), SUSCRIPCION(2, 10)]]);
      query.mockResolvedValue([{ affectedRows: 1 }]); // los UPDATE de last_ok_at
      webpush.sendNotification.mockResolvedValue({});

      const res = await push.notificarAdmins({
        titulo: 'Ambulancia 1', cuerpo: 'ha salido', url: '/asignaciones', tag: 'asig-1-activada',
      });

      expect(res).toMatchObject({ enviados: 2, fallidos: 0, borrados: 0 });
      expect(webpush.sendNotification).toHaveBeenCalledTimes(2);

      // El payload viaja como JSON con lo que espera el service worker.
      const [suscripcion, cuerpo] = webpush.sendNotification.mock.calls[0];
      expect(suscripcion).toEqual({
        endpoint: 'https://push.example/1',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      });
      expect(JSON.parse(cuerpo)).toEqual({
        titulo: 'Ambulancia 1', cuerpo: 'ha salido',
        url: '/asignaciones', tag: 'asig-1-activada',
      });

      const sellados = query.mock.calls.filter(c => /last_ok_at = \?/.test(c[0]));
      expect(sellados).toHaveLength(2);
    });

    it('sin suscripciones no llama a web-push', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([[]]);

      const res = await push.notificarAdmins({ titulo: 'x', cuerpo: 'y' });

      expect(res).toMatchObject({ enviados: 0, omitido: 'sin-suscripciones' });
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });

    it.each([404, 410])('borra la suscripción cuando el servicio responde %i', async (status) => {
      const push = cargarPush();
      query.mockResolvedValueOnce([[SUSCRIPCION(1)]]);
      query.mockResolvedValue([{ affectedRows: 1 }]);
      webpush.sendNotification.mockRejectedValueOnce(errorPush(status));

      const res = await push.notificarAdmins({ titulo: 'x', cuerpo: 'y' });

      expect(res).toMatchObject({ enviados: 0, borrados: 1 });
      const borrado = query.mock.calls.find(c => /DELETE FROM push_subscriptions/.test(c[0]));
      expect(borrado).toBeDefined();
      expect(borrado[1]).toEqual([1]);
    });

    it('un fallo pasajero (500) cuenta como fallido pero NO borra la suscripción', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([[SUSCRIPCION(1)]]);
      webpush.sendNotification.mockRejectedValueOnce(errorPush(500));

      const res = await push.notificarAdmins({ titulo: 'x', cuerpo: 'y' });

      expect(res).toMatchObject({ enviados: 0, fallidos: 1, borrados: 0 });
      expect(query.mock.calls.some(c => /DELETE FROM push_subscriptions/.test(c[0]))).toBe(false);
    });

    it('un destinatario roto no impide que los demás reciban el aviso', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([[SUSCRIPCION(1), SUSCRIPCION(2)]]);
      query.mockResolvedValue([{ affectedRows: 1 }]);
      webpush.sendNotification
        .mockRejectedValueOnce(errorPush(500))
        .mockResolvedValueOnce({});

      const res = await push.notificarAdmins({ titulo: 'x', cuerpo: 'y' });

      expect(res).toMatchObject({ enviados: 1, fallidos: 1 });
    });

    it('si la BD falla devuelve un resumen vacío en vez de lanzar', async () => {
      const push = cargarPush();
      query.mockRejectedValueOnce(new Error('BD caída'));

      await expect(push.notificarAdmins({ titulo: 'x', cuerpo: 'y' }))
        .resolves.toMatchObject({ enviados: 0, omitido: 'error' });
    });

    it('si falla el sellado de last_ok_at el aviso sigue contando como enviado', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([[SUSCRIPCION(1)]]);
      query.mockRejectedValueOnce(new Error('no se pudo actualizar'));
      webpush.sendNotification.mockResolvedValue({});

      const res = await push.notificarAdmins({ titulo: 'x', cuerpo: 'y' });

      expect(res).toMatchObject({ enviados: 1, fallidos: 0 });
    });
  });

  // ── Aviso a uno mismo ────────────────────────────────────
  describe('notificarUsuario', () => {
    it('solo consulta las suscripciones de ese usuario', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([[SUSCRIPCION(3, 42)]]);
      query.mockResolvedValue([{ affectedRows: 1 }]);
      webpush.sendNotification.mockResolvedValue({});

      const res = await push.notificarUsuario(42, { titulo: 'Prueba', cuerpo: 'suena' });

      expect(res.enviados).toBe(1);
      expect(query.mock.calls[0][1]).toEqual([42]);
    });

    it('sin dispositivos lo dice en vez de fingir que se envió', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([[]]);
      const res = await push.notificarUsuario(42, { titulo: 'x', cuerpo: 'y' });
      expect(res).toMatchObject({ enviados: 0, omitido: 'sin-suscripciones' });
    });

    it('no lanza si la BD falla', async () => {
      const push = cargarPush();
      query.mockRejectedValueOnce(new Error('BD caída'));
      await expect(push.notificarUsuario(42, { titulo: 'x', cuerpo: 'y' }))
        .resolves.toMatchObject({ omitido: 'error' });
    });
  });

  // ── Alta y baja ──────────────────────────────────────────
  describe('guardarSuscripcion', () => {
    it('inserta actualizando si el endpoint ya existía', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await push.guardarSuscripcion({
        userId: 5,
        subscription: { endpoint: 'https://push.example/abc', keys: { p256dh: 'P', auth: 'A' } },
        userAgent: 'Chrome/128 Android',
      });

      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/ON DUPLICATE KEY UPDATE/);
      expect(params.slice(0, 5)).toEqual([5, 'https://push.example/abc', 'P', 'A', 'Chrome/128 Android']);
      // El instante lo pone Node, no la BD (contrato de fechas).
      expect(params[5]).toBeInstanceOf(Date);
    });

    it('recorta un user-agent larguísimo a lo que cabe en la columna', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await push.guardarSuscripcion({
        userId: 5,
        subscription: { endpoint: 'e', keys: { p256dh: 'P', auth: 'A' } },
        userAgent: 'x'.repeat(400),
      });

      expect(query.mock.calls[0][1][4]).toHaveLength(255);
    });

    it('sin user-agent guarda NULL, no una cadena vacía', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await push.guardarSuscripcion({
        userId: 5,
        subscription: { endpoint: 'e', keys: { p256dh: 'P', auth: 'A' } },
      });

      expect(query.mock.calls[0][1][4]).toBeNull();
    });

    it('rechaza una suscripción sin claves', async () => {
      const push = cargarPush();
      await expect(push.guardarSuscripcion({
        userId: 5, subscription: { endpoint: 'https://push.example/abc' },
      })).rejects.toThrow(/Suscripción incompleta/);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('borrarSuscripcion', () => {
    it('acota el borrado al dueño: nadie da de baja el móvil de otro', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      const borrada = await push.borrarSuscripcion({ userId: 5, endpoint: 'e' });

      expect(borrada).toBe(true);
      const [sql, params] = query.mock.calls[0];
      expect(sql).toMatch(/endpoint = \? AND user_id = \?/);
      expect(params).toEqual(['e', 5]);
    });

    it('devuelve false si no había nada que borrar', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([{ affectedRows: 0 }]);
      await expect(push.borrarSuscripcion({ userId: 5, endpoint: 'e' })).resolves.toBe(false);
    });
  });

  describe('tieneSuscripcion', () => {
    it('true cuando el endpoint está registrado a nombre del usuario', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([[{ id: 1 }]]);
      await expect(push.tieneSuscripcion({ userId: 5, endpoint: 'e' })).resolves.toBe(true);
    });

    it('false cuando no lo está', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([[]]);
      await expect(push.tieneSuscripcion({ userId: 5, endpoint: 'e' })).resolves.toBe(false);
    });
  });

  describe('contarDispositivosPorUsuario', () => {
    it('agrupa por usuario', async () => {
      const push = cargarPush();
      query.mockResolvedValueOnce([[{ user_id: 1, dispositivos: 2 }]]);
      const filas = await push.contarDispositivosPorUsuario();
      expect(filas).toEqual([{ user_id: 1, dispositivos: 2 }]);
      expect(query.mock.calls[0][0]).toMatch(/GROUP BY user_id/);
    });
  });
});
