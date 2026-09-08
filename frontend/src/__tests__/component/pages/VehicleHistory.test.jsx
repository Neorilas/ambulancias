import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../services/vehicles.service.js', () => ({
  vehiclesService: {
    getHistory:      vi.fn(),
    get:             vi.fn(),
    listIncidencias: vi.fn(),
    listRevisiones:  vi.fn(),
  },
}));
vi.mock('../../../services/users.service.js', () => ({
  usersService: { list: vi.fn() },
}));

import { vehiclesService } from '../../../services/vehicles.service.js';
import { usersService }    from '../../../services/users.service.js';
import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import { AuthProvider }         from '../../../context/AuthContext.jsx';
import VehicleHistory           from '../../../pages/vehicles/VehicleHistory.jsx';

const VEHICULO = {
  id: 7, matricula: '1234ABC', alias: 'Ambulancia 3',
  kilometros_actuales: 120000, fecha_matriculacion: '2019-01-10',
  fecha_itv: '2026-01-10', fecha_its: '2026-03-01',
  fecha_tarjeta_transporte: '2027-01-01', fecha_ultimo_servicio: '2026-09-01',
  images: [],
};

function montar() {
  return render(
    <NotificationProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={['/vehiculos/7']}>
          <Routes>
            <Route path="/vehiculos/:id" element={<VehicleHistory />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </NotificationProvider>
  );
}

describe('VehicleHistory · peticiones de la ficha', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vehiclesService.getHistory.mockResolvedValue({ vehicle: VEHICULO, trabajos: [] });
    vehiclesService.get.mockResolvedValue(VEHICULO);
    vehiclesService.listIncidencias.mockResolvedValue([]);
    vehiclesService.listRevisiones.mockResolvedValue([]);
    usersService.list.mockResolvedValue({ data: [] });
  });

  it('pide cada juego de datos una sola vez al abrir la ficha', async () => {
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await waitFor(() => expect(vehiclesService.get).toHaveBeenCalledTimes(1));

    expect(vehiclesService.getHistory).toHaveBeenCalledTimes(1);
    expect(vehiclesService.listIncidencias).toHaveBeenCalledTimes(1);
    expect(vehiclesService.listRevisiones).toHaveBeenCalledTimes(1);
  });

  it('no trae los 300 empleados hasta que se abren las incidencias', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await waitFor(() => expect(vehiclesService.get).toHaveBeenCalledTimes(1));

    // Sólo los usa el selector de responsable de la pestaña de incidencias.
    expect(usersService.list).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Incidencias' }));
    await waitFor(() => expect(usersService.list).toHaveBeenCalledTimes(1));
  });

  // Las pestañas se desmontan al cambiar de una a otra: antes, cada vuelta
  // repetía la carga de datos que ya estaban en pantalla.
  it('no repite peticiones al pasearse por las pestañas', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await waitFor(() => expect(vehiclesService.get).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Incidencias' }));
    await user.click(screen.getByRole('button', { name: 'Revisiones' }));
    await user.click(screen.getByRole('button', { name: 'Fotos' }));
    await user.click(screen.getByRole('button', { name: 'Resumen' }));

    expect(vehiclesService.listIncidencias).toHaveBeenCalledTimes(1);
    expect(vehiclesService.listRevisiones).toHaveBeenCalledTimes(1);
    expect(vehiclesService.getHistory).toHaveBeenCalledTimes(1);
    expect(vehiclesService.get).toHaveBeenCalledTimes(1);
    expect(usersService.list).toHaveBeenCalledTimes(1);
  });
});
