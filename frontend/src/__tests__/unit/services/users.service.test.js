import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usersService } from '../../../services/users.service';
import api from '../../../services/api';

vi.mock('../../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const mockData = (data) => ({ data: { data } });

describe('users.service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list', async () => {
    api.get.mockResolvedValueOnce({ data: { data: [] } });
    await usersService.list();
    expect(api.get).toHaveBeenCalledWith('/users', { params: {} });
  });

  it('get', async () => {
    api.get.mockResolvedValueOnce(mockData({ id: 1 }));
    const r = await usersService.get(1);
    expect(r).toEqual({ id: 1 });
  });

  it('create', async () => {
    api.post.mockResolvedValueOnce(mockData({ id: 1 }));
    await usersService.create({ username: 'new' });
    expect(api.post).toHaveBeenCalledWith('/users', { username: 'new' });
  });

  it('update', async () => {
    api.put.mockResolvedValueOnce(mockData({ id: 1 }));
    await usersService.update(1, { nombre: 'X' });
    expect(api.put).toHaveBeenCalledWith('/users/1', { nombre: 'X' });
  });

  it('delete', async () => {
    api.delete.mockResolvedValueOnce({ data: {} });
    await usersService.delete(1);
    expect(api.delete).toHaveBeenCalledWith('/users/1');
  });

  it('listRoles', async () => {
    api.get.mockResolvedValueOnce(mockData([]));
    await usersService.listRoles();
    expect(api.get).toHaveBeenCalledWith('/users/roles');
  });

  it('createRole', async () => {
    api.post.mockResolvedValueOnce(mockData({ id: 10 }));
    await usersService.createRole({ nombre: 'nuevo' });
    expect(api.post).toHaveBeenCalledWith('/users/roles', { nombre: 'nuevo' });
  });
});
