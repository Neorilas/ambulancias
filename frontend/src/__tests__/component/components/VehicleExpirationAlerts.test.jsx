import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../services/vehicles.service.js', () => ({
  vehiclesService: { listAlertas: vi.fn() },
}));
vi.mock('../../../context/AuthContext.jsx', () => ({
  useAuth: () => ({ isAdmin: () => true, isSuperAdmin: () => false, isAuthenticated: true }),
}));

import { vehiclesService } from '../../../services/vehicles.service.js';
import VehicleExpirationAlerts from '../../../components/common/VehicleExpirationAlerts.jsx';
import { markDismissed, listDismissals } from '../../../utils/vehicleAlerts.js';

describe('VehicleExpirationAlerts · descartes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // Hasta 2026-10-12 podaba con la lista vacía del primer render: cada
  // arranque de la app borraba todos los descartes y las alertas volvían
  it('una carga fallida no borra los descartes', async () => {
    markDismissed({ vehicle_id: 7, tipo: 'itv', threshold: 30 });
    vehiclesService.listAlertas.mockRejectedValue(new Error('sin red'));

    render(<MemoryRouter><VehicleExpirationAlerts /></MemoryRouter>);
    await act(async () => {});

    expect(listDismissals()).toEqual(['alert_dismissed:7:itv:30']);
  });

  it('con la lista cargada, poda los que ya no tienen alerta detrás', async () => {
    markDismissed({ vehicle_id: 7, tipo: 'itv', threshold: 30 });
    vehiclesService.listAlertas.mockResolvedValue([]);

    render(<MemoryRouter><VehicleExpirationAlerts /></MemoryRouter>);
    await act(async () => {});

    expect(listDismissals()).toEqual([]);
  });
});

describe('VehicleExpirationAlerts · plegado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // Desde 2026-10-17 arrancan plegadas: solo el botón, y se abren a mano
  it('arranca plegada y se despliega al pulsar el botón', async () => {
    const enDiez = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    vehiclesService.listAlertas.mockResolvedValue([
      { vehicle_id: 7, tipo: 'itv', alias: 'Ambu 7', matricula: '1234ABC', fecha_caducidad: enDiez, dias_restantes: 10 },
    ]);

    render(<MemoryRouter><VehicleExpirationAlerts /></MemoryRouter>);
    await act(async () => {});

    const boton = screen.getByRole('button', { name: 'Ver 1 alerta' });
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(boton);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ocultar' })).toHaveAttribute('aria-expanded', 'true');
  });
});
