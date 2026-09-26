import { describe, it, expect, vi, beforeEach } from 'vitest';
import { informesService } from '../../../services/informes.service';
import api from '../../../services/api';

vi.mock('../../../services/api', () => ({ default: { get: vi.fn() } }));

describe('informes.service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getMensual pide el mes y desenvuelve data.data', async () => {
    api.get.mockResolvedValueOnce({ data: { data: { actual: { mes: '2026-08' } } } });
    const out = await informesService.getMensual('2026-08');
    expect(api.get).toHaveBeenCalledWith('/informes/mensual', { params: { mes: '2026-08' } });
    expect(out.actual.mes).toBe('2026-08');
  });

  it('sin mes no manda parámetro (el backend usa el en curso)', async () => {
    api.get.mockResolvedValueOnce({ data: { data: {} } });
    await informesService.getMensual();
    expect(api.get).toHaveBeenCalledWith('/informes/mensual', { params: {} });
  });
});
