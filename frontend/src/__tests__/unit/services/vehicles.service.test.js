import { describe, it, expect, vi, beforeEach } from 'vitest';
import { vehiclesService } from '../../../services/vehicles.service';
import api from '../../../services/api';

vi.mock('../../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockData = (data) => ({ data: { data } });

describe('vehicles.service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list', async () => {
    api.get.mockResolvedValueOnce({ data: { data: [] } });
    await vehiclesService.list();
    expect(api.get).toHaveBeenCalledWith('/vehicles', { params: {} });
  });

  it('get', async () => {
    api.get.mockResolvedValueOnce(mockData({ id: 1 }));
    const r = await vehiclesService.get(1);
    expect(r).toEqual({ id: 1 });
  });

  it('create', async () => {
    api.post.mockResolvedValueOnce(mockData({ id: 1 }));
    await vehiclesService.create({ matricula: 'ABC' });
    expect(api.post).toHaveBeenCalledWith('/vehicles', { matricula: 'ABC' });
  });

  it('update', async () => {
    api.put.mockResolvedValueOnce(mockData({ id: 1 }));
    await vehiclesService.update(1, { alias: 'X' });
    expect(api.put).toHaveBeenCalledWith('/vehicles/1', { alias: 'X' });
  });

  it('delete', async () => {
    api.delete.mockResolvedValueOnce({ data: {} });
    await vehiclesService.delete(1);
    expect(api.delete).toHaveBeenCalledWith('/vehicles/1');
  });

  it('getImages', async () => {
    api.get.mockResolvedValueOnce(mockData([]));
    await vehiclesService.getImages(1);
    expect(api.get).toHaveBeenCalledWith('/vehicles/1/images', { params: {} });
  });

  it('getHistory', async () => {
    api.get.mockResolvedValueOnce(mockData({}));
    await vehiclesService.getHistory(1);
    expect(api.get).toHaveBeenCalledWith('/vehicles/1/historial');
  });

  it('uploadImage', async () => {
    api.post.mockResolvedValueOnce(mockData({}));
    const fd = new FormData();
    await vehiclesService.uploadImage(1, fd);
    expect(api.post).toHaveBeenCalledWith('/vehicles/1/images', fd, { headers: { 'Content-Type': undefined } });
  });

  it('listIncidencias', async () => {
    api.get.mockResolvedValueOnce(mockData([]));
    await vehiclesService.listIncidencias(1);
    expect(api.get).toHaveBeenCalledWith('/vehicles/1/incidencias');
  });

  it('createIncidencia', async () => {
    api.post.mockResolvedValueOnce(mockData({}));
    await vehiclesService.createIncidencia(1, { descripcion: 'X' });
    expect(api.post).toHaveBeenCalledWith('/vehicles/1/incidencias', { descripcion: 'X' });
  });

  it('updateIncidencia', async () => {
    api.patch.mockResolvedValueOnce(mockData({}));
    await vehiclesService.updateIncidencia(1, 5, { estado: 'resuelto' });
    expect(api.patch).toHaveBeenCalledWith('/vehicles/1/incidencias/5', { estado: 'resuelto' });
  });

  it('listRevisiones', async () => {
    api.get.mockResolvedValueOnce(mockData([]));
    await vehiclesService.listRevisiones(1);
    expect(api.get).toHaveBeenCalledWith('/vehicles/1/revisiones');
  });

  it('createRevision', async () => {
    api.post.mockResolvedValueOnce(mockData({}));
    await vehiclesService.createRevision(1, { tipo: 'itv' });
    expect(api.post).toHaveBeenCalledWith('/vehicles/1/revisiones', { tipo: 'itv' });
  });

  it('updateRevision', async () => {
    api.put.mockResolvedValueOnce(mockData({}));
    await vehiclesService.updateRevision(1, 3, { resultado: 'realizado' });
    expect(api.put).toHaveBeenCalledWith('/vehicles/1/revisiones/3', { resultado: 'realizado' });
  });

  it('deleteRevision', async () => {
    api.delete.mockResolvedValueOnce({ data: {} });
    await vehiclesService.deleteRevision(1, 3);
    expect(api.delete).toHaveBeenCalledWith('/vehicles/1/revisiones/3');
  });
});
