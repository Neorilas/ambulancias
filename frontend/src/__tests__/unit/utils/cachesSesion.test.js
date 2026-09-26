import { describe, it, expect, vi, afterEach } from 'vitest';
import { vaciarCachesDeSesion, CACHES_DE_SESION } from '../../../utils/cachesSesion';

describe('vaciarCachesDeSesion', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('borra las cachés con datos de la sesión', async () => {
    const del = vi.fn().mockResolvedValue(true);
    vi.stubGlobal('caches', { delete: del });

    await vaciarCachesDeSesion();

    expect(CACHES_DE_SESION).toEqual(expect.arrayContaining(['api-cache', 'images-cache']));
    CACHES_DE_SESION.forEach((n) => expect(del).toHaveBeenCalledWith(n));
  });

  it('no revienta sin Cache Storage ni si el borrado falla', async () => {
    vi.stubGlobal('caches', undefined);
    await expect(vaciarCachesDeSesion()).resolves.toBeUndefined();

    vi.stubGlobal('caches', { delete: vi.fn().mockRejectedValue(new Error('x')) });
    await expect(vaciarCachesDeSesion()).resolves.toBeUndefined();
  });
});
