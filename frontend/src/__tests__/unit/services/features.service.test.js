import { describe, it, expect, vi, beforeEach } from 'vitest';
import { featuresService } from '../../../services/features.service';
import api from '../../../services/api';

vi.mock('../../../services/api', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

describe('features.service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getActive llama a GET /features/active y desenvuelve data.data', async () => {
    api.get.mockResolvedValueOnce({ data: { data: ['menu_vehiculos'] } });
    const out = await featuresService.getActive();
    expect(api.get).toHaveBeenCalledWith('/features/active');
    expect(out).toEqual(['menu_vehiculos']);
  });

  it('listAll llama a GET /features', async () => {
    api.get.mockResolvedValueOnce({ data: { data: [{ key: 'menu_vehiculos', enabled: 1 }] } });
    const out = await featuresService.listAll();
    expect(api.get).toHaveBeenCalledWith('/features');
    expect(out).toEqual([{ key: 'menu_vehiculos', enabled: 1 }]);
  });

  it('toggle llama a PUT /features/:key con el estado en el cuerpo', async () => {
    api.get.mockClear();
    api.put.mockResolvedValueOnce({ data: { data: { key: 'menu_trabajos', enabled: false } } });
    const out = await featuresService.toggle('menu_trabajos', false);
    expect(api.put).toHaveBeenCalledWith('/features/menu_trabajos', { enabled: false });
    expect(out).toEqual({ key: 'menu_trabajos', enabled: false });
  });

  it('toggle también sirve para activar', async () => {
    api.put.mockResolvedValueOnce({ data: { data: { key: 'menu_trabajos', enabled: true } } });
    await featuresService.toggle('menu_trabajos', true);
    expect(api.put).toHaveBeenCalledWith('/features/menu_trabajos', { enabled: true });
  });

  it('el error de la API sube al llamante', async () => {
    api.get.mockRejectedValueOnce(new Error('403'));
    await expect(featuresService.getActive()).rejects.toThrow('403');
  });
});
