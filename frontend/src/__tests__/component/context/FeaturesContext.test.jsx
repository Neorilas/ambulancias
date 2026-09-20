import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { FeaturesProvider, useFeatures } from '../../../context/FeaturesContext';
import { featuresService } from '../../../services/features.service';
import { useAuth } from '../../../context/AuthContext';

vi.mock('../../../services/features.service', () => ({
  featuresService: { getActive: vi.fn() },
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

/** Sesión por defecto: usuario normal autenticado. */
function sesion({ isAuthenticated = true, isSuperAdmin = false } = {}) {
  useAuth.mockReturnValue({
    isAuthenticated,
    isSuperAdmin: () => isSuperAdmin,
  });
}

function TestConsumer() {
  const { features, loading, isFeatureEnabled, reload } = useFeatures();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="features">{features.join(',')}</span>
      <span data-testid="vehiculos">{String(isFeatureEnabled('menu_vehiculos'))}</span>
      <span data-testid="trabajos">{String(isFeatureEnabled('menu_trabajos'))}</span>
      <button onClick={reload}>reload</button>
    </div>
  );
}

const montar = () => render(
  <FeaturesProvider><TestConsumer /></FeaturesProvider>
);

describe('FeaturesContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sesion();
  });

  it('carga los flags activos del backend', async () => {
    featuresService.getActive.mockResolvedValueOnce(['menu_vehiculos']);
    montar();

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(featuresService.getActive).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('features').textContent).toBe('menu_vehiculos');
  });

  it('isFeatureEnabled responde según la lista cargada', async () => {
    featuresService.getActive.mockResolvedValueOnce(['menu_vehiculos']);
    montar();

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('vehiculos').textContent).toBe('true');
    expect(screen.getByTestId('trabajos').textContent).toBe('false');
  });

  it('sin sesión no pregunta al backend y deja la lista vacía', async () => {
    sesion({ isAuthenticated: false });
    montar();

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(featuresService.getActive).not.toHaveBeenCalled();
    expect(screen.getByTestId('features').textContent).toBe('');
    expect(screen.getByTestId('vehiculos').textContent).toBe('false');
  });

  it('si la petición falla, la app sigue con todo apagado en vez de romperse', async () => {
    featuresService.getActive.mockRejectedValueOnce(new Error('500'));
    montar();

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('features').textContent).toBe('');
    expect(screen.getByTestId('vehiculos').textContent).toBe('false');
  });

  it('el superadmin ve todo, esté o no el flag activo', async () => {
    sesion({ isSuperAdmin: true });
    featuresService.getActive.mockResolvedValueOnce([]);
    montar();

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('vehiculos').textContent).toBe('true');
    expect(screen.getByTestId('trabajos').textContent).toBe('true');
  });

  it('reload vuelve a pedir los flags', async () => {
    featuresService.getActive
      .mockResolvedValueOnce(['menu_vehiculos'])
      .mockResolvedValueOnce(['menu_vehiculos', 'menu_trabajos']);
    montar();

    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));

    await act(() => screen.getByText('reload').click());

    await waitFor(() =>
      expect(screen.getByTestId('trabajos').textContent).toBe('true'));
    expect(featuresService.getActive).toHaveBeenCalledTimes(2);
  });

  it('useFeatures fuera del provider avisa en vez de devolver undefined', () => {
    const silencio = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer />))
      .toThrow('useFeatures debe usarse dentro de <FeaturesProvider>');
    silencio.mockRestore();
  });
});
