import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flotaService } from '../../../services/flota.service';
import api from '../../../services/api';

vi.mock('../../../services/api', () => ({
  default: { get: vi.fn() },
}));

describe('flota.service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getUbicaciones llama a GET /flota/ubicaciones y desenvuelve data.data', async () => {
    const payload = {
      flota: [{ clave: 'v-1', alias: 'Ambulancia 1', estado: 'movimiento' }],
      resumen: { total: 1, vinculados: 1 },
      fuente: { configurado: true, origen: 'api', error: null },
      minutosSinSenal: 30,
    };
    api.get.mockResolvedValueOnce({ data: { data: payload } });

    const out = await flotaService.getUbicaciones();

    expect(api.get).toHaveBeenCalledWith('/flota/ubicaciones');
    expect(out).toEqual(payload);
  });

  it('propaga el error para que la pantalla decida qué avisar', async () => {
    // Un 403 aquí es lo normal para quien no es superadmin; la página lo
    // convierte en un aviso, no el servicio.
    api.get.mockRejectedValueOnce(new Error('Request failed with status code 403'));
    await expect(flotaService.getUbicaciones()).rejects.toThrow(/403/);
  });
});
