import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pushService } from '../../../services/push.service';
import api from '../../../services/api';

vi.mock('../../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockData = (data) => ({ data: { data } });

describe('push.service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getClavePublica', async () => {
    api.get.mockResolvedValueOnce(mockData({ configurado: true, publicKey: 'K' }));
    const r = await pushService.getClavePublica();
    expect(api.get).toHaveBeenCalledWith('/push/vapid-public-key');
    expect(r).toEqual({ configurado: true, publicKey: 'K' });
  });

  it('getEstado manda el endpoint en el body, no en la URL', async () => {
    api.post.mockResolvedValueOnce(mockData({ registrado: true }));
    await pushService.getEstado('https://push.example/x');
    expect(api.post).toHaveBeenCalledWith('/push/estado', { endpoint: 'https://push.example/x' });
    expect(api.get).not.toHaveBeenCalled();
  });

  it('getEstado sin endpoint no manda un endpoint undefined', async () => {
    api.post.mockResolvedValueOnce(mockData({ registrado: false }));
    await pushService.getEstado();
    expect(api.post).toHaveBeenCalledWith('/push/estado', {});
  });

  it('subscribe serializa el PushSubscription con toJSON', async () => {
    // El PushSubscription del navegador no es un objeto plano: sin toJSON()
    // viajaría vacío y el backend rechazaría el alta por falta de claves.
    const subscription = {
      endpoint: 'https://push.example/x',
      toJSON: () => ({ endpoint: 'https://push.example/x', keys: { p256dh: 'P', auth: 'A' } }),
    };
    api.post.mockResolvedValueOnce(mockData({ suscrito: true }));

    await pushService.subscribe(subscription);

    expect(api.post).toHaveBeenCalledWith('/push/subscribe', {
      subscription: { endpoint: 'https://push.example/x', keys: { p256dh: 'P', auth: 'A' } },
    });
  });

  it('subscribe acepta también un objeto plano (sin toJSON)', async () => {
    const plano = { endpoint: 'e', keys: { p256dh: 'P', auth: 'A' } };
    api.post.mockResolvedValueOnce(mockData({ suscrito: true }));

    await pushService.subscribe(plano);

    expect(api.post).toHaveBeenCalledWith('/push/subscribe', { subscription: plano });
  });

  it('unsubscribe manda el endpoint en el cuerpo del DELETE', async () => {
    api.delete.mockResolvedValueOnce(mockData({ borrada: true }));
    await pushService.unsubscribe('e');
    expect(api.delete).toHaveBeenCalledWith('/push/subscribe', { data: { endpoint: 'e' } });
  });

  it('test', async () => {
    api.post.mockResolvedValueOnce({ data: { success: true, message: 'ok' } });
    const r = await pushService.test();
    expect(api.post).toHaveBeenCalledWith('/push/test');
    expect(r).toEqual({ success: true, message: 'ok' });
  });
});
