import { describe, it, expect, vi, afterEach } from 'vitest';

describe('VERSION_APP', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('usa la versión que inyecta el build', async () => {
    vi.stubGlobal('__APP_VERSION__', '1.4.2');
    const { VERSION_APP } = await import('../../../utils/version.js');
    expect(VERSION_APP).toBe('1.4.2');
  });

  it('sin build (tests, herramientas) no revienta y lo dice', async () => {
    const { VERSION_APP } = await import('../../../utils/version.js');
    expect(VERSION_APP).toBe('desarrollo');
  });
});
