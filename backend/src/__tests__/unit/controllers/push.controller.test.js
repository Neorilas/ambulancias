'use strict';

/**
 * Tests de controllers/push.controller.js
 * El servicio va mockeado: aquí se comprueba el contrato HTTP.
 */

jest.mock('../../../services/push.service', () => ({
  estaConfigurado:     jest.fn(),
  clavePublica:        jest.fn(),
  guardarSuscripcion:  jest.fn(),
  borrarSuscripcion:   jest.fn(),
  tieneSuscripcion:    jest.fn(),
  notificarUsuario:    jest.fn(),
}));

const push = require('../../../services/push.service');
const { getClavePublica, subscribe, unsubscribe, estado, test: enviarPrueba } =
  require('../../../controllers/push.controller');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

const ADMIN = { id: 3, username: 'fjtamayo', roles: ['administrador'], permissions: ['manage_trabajos'] };

describe('push.controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    push.estaConfigurado.mockReturnValue(true);
    push.clavePublica.mockReturnValue('CLAVE_PUBLICA');
  });

  // ── GET /push/vapid-public-key ───────────────────────────
  describe('getClavePublica', () => {
    it('devuelve la clave cuando el entorno tiene push', async () => {
      const res = mockRes();
      await getClavePublica(mockReq({ user: ADMIN }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].data).toEqual({
        configurado: true, publicKey: 'CLAVE_PUBLICA',
      });
    });

    it('sin claves responde 200 con configurado:false, no un error', async () => {
      // El frontend tiene que poder distinguir «este entorno no tiene push»
      // (y explicarlo) de «la petición ha fallado» (y reintentar).
      push.estaConfigurado.mockReturnValue(false);
      push.clavePublica.mockReturnValue(null);

      const res = mockRes();
      await getClavePublica(mockReq({ user: ADMIN }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].data).toEqual({
        configurado: false, publicKey: null,
      });
    });
  });

  // ── POST /push/subscribe ─────────────────────────────────
  describe('subscribe', () => {
    const SUSCRIPCION = { endpoint: 'https://push.example/x', keys: { p256dh: 'P', auth: 'A' } };

    it('guarda la suscripción a nombre del usuario autenticado', async () => {
      push.guardarSuscripcion.mockResolvedValue();

      const res = mockRes();
      await subscribe(mockReq({
        user: ADMIN,
        body: { subscription: SUSCRIPCION },
        headers: { 'user-agent': 'Chrome/128' },
      }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(push.guardarSuscripcion).toHaveBeenCalledWith({
        userId: 3, subscription: SUSCRIPCION, userAgent: 'Chrome/128',
      });
    });

    it('400 si no llega la suscripción', async () => {
      const res = mockRes();
      await subscribe(mockReq({ user: ADMIN, body: {} }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(push.guardarSuscripcion).not.toHaveBeenCalled();
    });

    it('una suscripción a medias es un 400, no un 500', async () => {
      push.guardarSuscripcion.mockRejectedValue(new Error('Suscripción incompleta: faltan endpoint o claves'));

      const res = mockRes();
      const next = mockNext();
      await subscribe(mockReq({ user: ADMIN, body: { subscription: { endpoint: 'x' } } }), res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('un servicio de push no reconocido es un 400', async () => {
      push.guardarSuscripcion.mockRejectedValue(new Error('Suscripción rechazada: servicio de push no reconocido'));

      const res = mockRes();
      const next = mockNext();
      await subscribe(mockReq({ user: ADMIN, body: { subscription: SUSCRIPCION } }), res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(next).not.toHaveBeenCalled();
    });

    it('un fallo inesperado va al manejador de errores', async () => {
      push.guardarSuscripcion.mockRejectedValue(new Error('BD caída'));

      const next = mockNext();
      await subscribe(mockReq({ user: ADMIN, body: { subscription: SUSCRIPCION } }), mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // ── DELETE /push/subscribe ───────────────────────────────
  describe('unsubscribe', () => {
    it('borra acotando al usuario autenticado', async () => {
      push.borrarSuscripcion.mockResolvedValue(true);

      const res = mockRes();
      await unsubscribe(mockReq({ user: ADMIN, body: { endpoint: 'e' } }), res, mockNext());

      expect(push.borrarSuscripcion).toHaveBeenCalledWith({ userId: 3, endpoint: 'e' });
      expect(res.json.mock.calls[0][0].data).toEqual({ borrada: true });
    });

    it('dar de baja algo que no estaba de alta no es un error', async () => {
      push.borrarSuscripcion.mockResolvedValue(false);

      const res = mockRes();
      await unsubscribe(mockReq({ user: ADMIN, body: { endpoint: 'e' } }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].data).toEqual({ borrada: false });
    });

    it('400 sin endpoint', async () => {
      const res = mockRes();
      await unsubscribe(mockReq({ user: ADMIN, body: {} }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── POST/GET /push/estado ────────────────────────────────
  describe('estado', () => {
    it('lee el endpoint del body (POST)', async () => {
      push.tieneSuscripcion.mockResolvedValue(true);

      const res = mockRes();
      await estado(mockReq({ user: ADMIN, body: { endpoint: 'e' }, query: {} }), res, mockNext());

      expect(push.tieneSuscripcion).toHaveBeenCalledWith({ userId: 3, endpoint: 'e' });
      expect(res.json.mock.calls[0][0].data.registrado).toBe(true);
    });

    it('dice si ESTE endpoint está registrado', async () => {
      push.tieneSuscripcion.mockResolvedValue(true);

      const res = mockRes();
      await estado(mockReq({ user: ADMIN, query: { endpoint: 'e' } }), res, mockNext());

      expect(push.tieneSuscripcion).toHaveBeenCalledWith({ userId: 3, endpoint: 'e' });
      expect(res.json.mock.calls[0][0].data).toEqual({ configurado: true, registrado: true });
    });

    it('sin endpoint no consulta nada y responde registrado:false', async () => {
      const res = mockRes();
      await estado(mockReq({ user: ADMIN, query: {} }), res, mockNext());

      expect(push.tieneSuscripcion).not.toHaveBeenCalled();
      expect(res.json.mock.calls[0][0].data.registrado).toBe(false);
    });
  });

  // ── POST /push/test ──────────────────────────────────────
  describe('test', () => {
    it('manda el aviso al propio usuario', async () => {
      push.notificarUsuario.mockResolvedValue({ enviados: 2, borrados: 0, fallidos: 0 });

      const res = mockRes();
      await enviarPrueba(mockReq({ user: ADMIN }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(200);
      expect(push.notificarUsuario).toHaveBeenCalledWith(3, expect.objectContaining({
        titulo: 'Aviso de prueba',
      }));
    });

    it('usa un tag fijo por usuario, no uno por envío', async () => {
      // Con un tag distinto cada vez, las pruebas se apilan en la bandeja del
      // móvil y Android deja de alertar de las siguientes. Con el mismo tag, la
      // nueva sustituye a la anterior y vuelve a sonar.
      push.notificarUsuario.mockResolvedValue({ enviados: 1, borrados: 0, fallidos: 0 });

      await enviarPrueba(mockReq({ user: ADMIN }), mockRes(), mockNext());
      await enviarPrueba(mockReq({ user: ADMIN }), mockRes(), mockNext());

      const tags = push.notificarUsuario.mock.calls.map(([, aviso]) => aviso.tag);
      expect(tags).toEqual(['test-3', 'test-3']);
    });

    it('503 si el entorno no tiene push configurado', async () => {
      push.estaConfigurado.mockReturnValue(false);

      const res = mockRes();
      await enviarPrueba(mockReq({ user: ADMIN }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(503);
      expect(push.notificarUsuario).not.toHaveBeenCalled();
    });

    it('400 si el usuario no tiene ningún dispositivo de alta', async () => {
      push.notificarUsuario.mockResolvedValue({ enviados: 0, omitido: 'sin-suscripciones' });

      const res = mockRes();
      await enviarPrueba(mockReq({ user: ADMIN }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('502 si había dispositivos pero no llegó a ninguno', async () => {
      // Distinguirlo del caso anterior importa: aquí el consejo útil es
      // volver a activar los avisos, no «date de alta».
      push.notificarUsuario.mockResolvedValue({ enviados: 0, borrados: 1, fallidos: 0 });

      const res = mockRes();
      await enviarPrueba(mockReq({ user: ADMIN }), res, mockNext());

      expect(res.status).toHaveBeenCalledWith(502);
    });
  });
});
