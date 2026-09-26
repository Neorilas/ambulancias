import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../services/vehicles.service.js', () => ({
  vehiclesService: { list: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../../services/auth.service.js', () => ({
  authService: { login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));

import { vehiclesService }      from '../../../services/vehicles.service.js';
import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import { AuthProvider }         from '../../../context/AuthContext.jsx';
import { PREFIJO }              from '../../../utils/sessionStorage.js';
import VehicleList              from '../../../pages/vehicles/VehicleList.jsx';
import { tabInicial }           from '../../../pages/vehicles/VehicleHistory.jsx';

function sesion(roles) {
  localStorage.setItem(PREFIJO + 'accessToken', 'tok');
  localStorage.setItem(PREFIJO + 'user', JSON.stringify({
    id: 1, username: 'u', roles, permissions: ['manage_vehicles'],
  }));
}

const FLOTA = [
  { id: 1, alias: 'Ambulancia 1', matricula: '1111AAA', incidencias_abiertas: 2, incidencias_gravedad_max: 'grave' },
  { id: 2, alias: 'Ambulancia 2', matricula: '2222BBB', incidencias_abiertas: 1, incidencias_gravedad_max: 'leve' },
  { id: 3, alias: 'Ambulancia 3', matricula: '3333CCC', incidencias_abiertas: 0, incidencias_gravedad_max: null },
];

function montar() {
  return render(
    <NotificationProvider>
      <AuthProvider>
        <MemoryRouter><VehicleList /></MemoryRouter>
      </AuthProvider>
    </NotificationProvider>
  );
}

describe('VehicleList · incidencias abiertas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vehiclesService.list.mockResolvedValue({
      data: FLOTA, pagination: { total: 3, totalPages: 1 },
    });
  });

  it('muestra en la tabla cuántas incidencias abiertas tiene cada vehículo', async () => {
    sesion(['administrador']);
    montar();

    const tabla = await screen.findByRole('table');
    expect(within(tabla).getByRole('columnheader', { name: 'Incidencias' })).toBeInTheDocument();

    const grave = within(tabla).getByRole('link', { name: '2 abiertas · grave' });
    expect(grave).toHaveAttribute('href', '/vehiculos/1?tab=incidencias');
    expect(grave.className).toContain('badge-red');

    const leve = within(tabla).getByRole('link', { name: '1 abierta' });
    expect(leve.className).toContain('badge-yellow');

    expect(within(tabla).getByText('Sin incidencias')).toBeInTheDocument();
  });

  it('el filtro pide solo los vehículos con incidencias abiertas', async () => {
    sesion(['gestor']);
    montar();
    await screen.findByRole('table');

    await userEvent.click(screen.getByRole('button', { name: 'Solo con incidencias' }));

    await waitFor(() => expect(vehiclesService.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ incidencias: 'abiertas', page: 1 })
    ));
  });

  it('sin rol de gestión no ofrece ni la columna ni el filtro', async () => {
    sesion(['tecnico']);
    vehiclesService.list.mockResolvedValue({
      data: [{ id: 4, alias: 'Ambulancia 4', matricula: '4444DDD' }],
      pagination: { total: 1, totalPages: 1 },
    });
    montar();

    const tabla = await screen.findByRole('table');
    expect(within(tabla).queryByRole('columnheader', { name: 'Incidencias' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Solo con incidencias' })).toBeNull();
  });
});

describe('VehicleList · asignación en curso o programada', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vehiclesService.list.mockResolvedValue({
      data: [
        { id: 1, alias: 'Ambulancia 1', matricula: '1111AAA', asignacion_estado: 'activa' },
        // 06:30 UTC = 08:30 en Madrid (horario de verano)
        { id: 2, alias: 'Ambulancia 2', matricula: '2222BBB', asignacion_estado: 'programada',
          asignacion_proxima_inicio: '2026-09-28T06:30:00.000Z' },
        { id: 3, alias: 'Ambulancia 3', matricula: '3333CCC', asignacion_estado: null },
      ],
      pagination: { total: 3, totalPages: 1 },
    });
  });

  it('marca las que están en servicio y las que tienen uno programado', async () => {
    sesion(['administrador']);
    montar();

    const tabla = await screen.findByRole('table');
    const enServicio = within(tabla).getByText('En servicio');
    expect(enServicio.className).toContain('badge-green');
    const programada = within(tabla).getByText(/^Programada · 28\/09 08:30$/);
    expect(programada.className).toContain('badge-blue');
    // Libre no se marca: es lo normal.
    expect(within(tabla).getAllByText(/En servicio|Programada/)).toHaveLength(2);
  });
});

describe('VehicleHistory · tabInicial', () => {
  it('abre la pestaña que pide ?tab=', () => {
    expect(tabInicial('/vehiculos/1', '?tab=incidencias')).toBe('incidencias');
  });
  it('ignora una pestaña que no existe', () => {
    expect(tabInicial('/vehiculos/1', '?tab=nada')).toBe('resumen');
    expect(tabInicial('/vehiculos/1/historial', '?tab=nada')).toBe('fotos');
  });
});
