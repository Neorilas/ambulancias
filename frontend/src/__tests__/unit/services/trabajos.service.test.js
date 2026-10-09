import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trabajosService } from '../../../services/trabajos.service';
import api from '../../../services/api';

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
});
