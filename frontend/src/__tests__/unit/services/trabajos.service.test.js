import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trabajosService } from '../../../services/trabajos.service';
import api from '../../../services/api';
import { SUBIDA_FOTO_TIMEOUT_MS } from '../../../utils/subidaFotos';

vi.mock('../../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockData = (data) => ({ data: { data } });

describe('trabajos.service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list', async () => {
    api.get.mockResolvedValueOnce({ data: { data: [], total: 0 } });
    await trabajosService.list({ page: 1 });
    expect(api.get).toHaveBeenCalledWith('/trabajos', { params: { page: 1 } });
  });

  it('listCalendario', async () => {
    api.get.mockResolvedValueOnce(mockData([]));
    await trabajosService.listCalendario({ year: 2026, month: 4 });
    expect(api.get).toHaveBeenCalledWith('/trabajos/calendario', { params: { year: 2026, month: 4 } });
  });

  it('misTrab', async () => {
    api.get.mockResolvedValueOnce({ data: { data: [] } });
    await trabajosService.misTrab();
    expect(api.get).toHaveBeenCalledWith('/trabajos/mis-trabajos', { params: {} });
  });

  it('get', async () => {
    api.get.mockResolvedValueOnce(mockData({ id: 1 }));
    const r = await trabajosService.get(1);
    expect(r).toEqual({ id: 1 });
  });

  it('create', async () => {
    api.post.mockResolvedValueOnce(mockData({ id: 1 }));
    await trabajosService.create({ nombre: 'test' });
    expect(api.post).toHaveBeenCalledWith('/trabajos', { nombre: 'test' });
  });

  it('update', async () => {
    api.put.mockResolvedValueOnce(mockData({ id: 1 }));
    await trabajosService.update(1, { nombre: 'up' });
    expect(api.put).toHaveBeenCalledWith('/trabajos/1', { nombre: 'up' });
  });

  it('delete', async () => {
    api.delete.mockResolvedValueOnce({ data: {} });
    await trabajosService.delete(1);
    expect(api.delete).toHaveBeenCalledWith('/trabajos/1');
  });

  it('cerrar: lo cierra el coordinador (v33)', async () => {
    api.post.mockResolvedValueOnce(mockData({ id: 1, estado: 'finalizado' }));
    const r = await trabajosService.cerrar(1);
    expect(api.post).toHaveBeenCalledWith('/trabajos/1/cerrar');
    expect(r).toEqual({ id: 1, estado: 'finalizado' });
  });

  // Modelo v25: convive hasta la fase 6 para terminar los trabajos antiguos
  describe('ciclo v25', () => {
    it('activar (sin vehículos)', async () => {
      api.post.mockResolvedValueOnce(mockData({ id: 1 }));
      await trabajosService.activar(1);
      expect(api.post).toHaveBeenCalledWith('/trabajos/1/activar');
    });

    it('finalize (sin vehículos)', async () => {
      api.post.mockResolvedValueOnce({ data: { message: 'ok' } });
      await trabajosService.finalize(1, { motivo_finalizacion_anticipada: 'Se suspende' });
      expect(api.post).toHaveBeenCalledWith('/trabajos/1/finalize', { motivo_finalizacion_anticipada: 'Se suspende' });
    });

    it('activarVehiculo', async () => {
      api.post.mockResolvedValueOnce(mockData({ id: 1 }));
      const r = await trabajosService.activarVehiculo(1, 7);
      expect(api.post).toHaveBeenCalledWith('/trabajos/1/vehiculos/7/activar');
      expect(r).toEqual({ id: 1 });
    });

    it('finalizeVehiculo', async () => {
      api.post.mockResolvedValueOnce({ data: { message: 'ok' } });
      const r = await trabajosService.finalizeVehiculo(1, 7, { kilometros_fin: 1200 });
      expect(api.post).toHaveBeenCalledWith('/trabajos/1/vehiculos/7/finalize', { kilometros_fin: 1200 });
      expect(r).toEqual({ message: 'ok' });
    });

    it('uploadEvidencia, con el timeout largo de las fotos', async () => {
      api.post.mockResolvedValueOnce(mockData({}));
      const fd = new FormData();
      await trabajosService.uploadEvidencia(1, fd);
      expect(api.post).toHaveBeenCalledWith('/trabajos/1/evidencias', fd, {
        headers: { 'Content-Type': undefined }, timeout: SUBIDA_FOTO_TIMEOUT_MS,
      });
      expect(SUBIDA_FOTO_TIMEOUT_MS).toBeGreaterThan(30000);
    });
  });
});
