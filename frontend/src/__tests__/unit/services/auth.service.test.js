import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authService } from '../../../services/auth.service';
import api from '../../../services/api';

vi.mock('../../../services/api', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

describe('auth.service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('login calls POST /auth/login and returns data.data', async () => {
    api.post.mockResolvedValueOnce({ data: { data: { accessToken: 'tok', user: { id: 1 } } } });
    const result = await authService.login('admin', 'pass');
    expect(api.post).toHaveBeenCalledWith('/auth/login', { username: 'admin', password: 'pass' });
    expect(result.accessToken).toBe('tok');
  });

  it('refresh calls POST /auth/refresh', async () => {
    api.post.mockResolvedValueOnce({ data: { data: { accessToken: 'new' } } });
    const result = await authService.refresh('refresh-tok');
    expect(api.post).toHaveBeenCalledWith('/auth/refresh', { refreshToken: 'refresh-tok' });
  });

  it('logout calls POST /auth/logout', async () => {
    api.post.mockResolvedValueOnce({});
    await authService.logout('refresh-tok');
    expect(api.post).toHaveBeenCalledWith('/auth/logout', { refreshToken: 'refresh-tok' });
  });

  it('me calls GET /auth/me', async () => {
    api.get.mockResolvedValueOnce({ data: { data: { id: 1, username: 'admin' } } });
    const result = await authService.me();
    expect(api.get).toHaveBeenCalledWith('/auth/me');
  });
});
