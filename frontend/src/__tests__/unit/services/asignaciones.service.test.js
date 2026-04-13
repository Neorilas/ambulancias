import { describe, it, expect, vi, beforeEach } from 'vitest';
import { asignacionesService } from '../../../services/asignaciones.service';
import api from '../../../services/api';

vi.mock('../../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockData = (data) => ({ data: { data } });

describe('asignaciones.service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list', async () => {
    api.get.mockResolvedValueOnce({ data: { data: [] } });
    await asignacionesService.list();
    expect(api.get).toHaveBeenCalledWith('/asignaciones', { params: {} });
  });

  it('get', async () => {
    api.get.mockResolvedValueOnce(mockData({ id: 1 }));
    const r = await asignacionesService.get(1);
    expect(r).toEqual({ id: 1 });
  });

  it('create', async () => {
    api.post.mockResolvedValueOnce(mockData({ id: 1 }));
    await asignacionesService.create({ vehicle_id: 1 });
    expect(api.post).toHaveBeenCalledWith('/asignaciones', { vehicle_id: 1 });
  });

  it('update', async () => {
    api.put.mockResolvedValueOnce(mockData({ id: 1 }));
    await asignacionesService.update(1, { notas: 'X' });
    expect(api.put).toHaveBeenCalledWith('/asignaciones/1', { notas: 'X' });
  });

  it('delete', async () => {
    api.delete.mockResolvedValueOnce({ data: {} });
    await asignacionesService.delete(1);
    expect(api.delete).toHaveBeenCalledWith('/asignaciones/1');
  });

  it('activar', async () => {
    api.post.mockResolvedValueOnce(mockData({}));
    await asignacionesService.activar(1);
    expect(api.post).toHaveBeenCalledWith('/asignaciones/1/activar');
  });

  it('finalizar', async () => {
    api.post.mockResolvedValueOnce(mockData({}));
    await asignacionesService.finalizar(1, { km_fin: 50000 });
    expect(api.post).toHaveBeenCalledWith('/asignaciones/1/finalizar', { km_fin: 50000 });
  });

  it('uploadEvidencia', async () => {
    api.post.mockResolvedValueOnce(mockData({}));
    const fd = new FormData();
    await asignacionesService.uploadEvidencia(1, fd);
    expect(api.post).toHaveBeenCalledWith('/asignaciones/1/evidencias', fd, { headers: { 'Content-Type': undefined } });
  });
});
