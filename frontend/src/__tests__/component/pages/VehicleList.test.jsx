import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

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

function Donde() {
  const { pathname, search } = useLocation();
  return <p data-testid="donde">{pathname}{search}</p>;
}

function montar(ruta = '/vehiculos') {
  return render(
    <NotificationProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[ruta]}>
          <Routes><Route path="/vehiculos" element={<VehicleList />} /></Routes>
          <Donde />
        </MemoryRouter>
      </AuthProvider>
    </NotificationProvider>
  );
}

// Página, búsqueda y «con incidencias» en la URL: al volver de la ficha de un
// vehículo se sigue donde se estaba (§8 del mapa, «La navegación hacia atrás»)
describe('VehicleList · lo que se estaba mirando sobrevive a ir a una ficha', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sesion(['administrador']);
    vehiclesService.list.mockResolvedValue({
      data: FLOTA, pagination: { total: 60, totalPages: 3, hasPrev: true, hasNext: true },
    });
  });

  it('la página, la búsqueda y el filtro de la URL se aplican al volver', async () => {
    montar('/vehiculos?page=2&q=uvi&incidencias=abiertas');
    await screen.findByRole('table');
    await waitFor(() => expect(vehiclesService.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, search: 'uvi', incidencias: 'abiertas' })));
    expect(screen.getByRole('searchbox')).toHaveValue('uvi');
    expect(screen.getByRole('button', { name: /incidencias/i, pressed: true })).toBeInTheDocument();
  });

  it('pasar de página la apunta; buscar vuelve a la 1', async () => {
    const user = userEvent.setup();
    montar('/vehiculos?page=2');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /Siguiente/ }));
    expect(screen.getByTestId('donde')).toHaveTextContent('/vehiculos?page=3');
    await user.type(screen.getByRole('searchbox'), 'ab');
    // El campo tiene lo tecleado al momento (no espera a la URL, que el router
    // aplica en una transición) y la búsqueda llega a la URL ya reposada
    expect(screen.getByRole('searchbox')).toHaveValue('ab');
    await waitFor(() => expect(screen.getByTestId('donde')).toHaveTextContent(/^\/vehiculos\?q=ab$/));
    // La petición sale un render después de que cambie la URL: hay que
    // esperarla también (en CI, con la máquina cargada, llegaba tarde)
    await waitFor(() => expect(vehiclesService.list)
      .toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: 'ab' })));
    expect(vehiclesService.list).not.toHaveBeenCalledWith(expect.objectContaining({ search: 'a' }));
  });
});

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

// Una carga fallida no es una flota vacía: decía «0 en flota / Todavía no hay
// vehículos registrados» con 4 en la BD (2026-10-11)
describe('VehicleList · la carga falla', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sesion(['administrador']);
  });

  it('enseña el error y no «Sin vehículos»; Reintentar vuelve a pedir', async () => {
    const user = userEvent.setup();
    vehiclesService.list.mockReset()
      .mockRejectedValueOnce(Object.assign(new Error('Network Error'), { config: { method: 'get', url: '/vehicles' } }))
      .mockResolvedValue({ data: FLOTA, pagination: { total: 3, totalPages: 1 } });
    montar();

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar los vehículos');
    expect(screen.queryByText('Sin vehículos')).not.toBeInTheDocument();
    expect(screen.getByText(/— en flota/)).toBeInTheDocument();
    // El fallo de red va al panel de errores (cola de utils/reporteErrores.js)
    expect(JSON.parse(localStorage.getItem(PREFIJO + 'erroresPendientes'))).toEqual([
      expect.objectContaining({ metodo: 'GET', url: '/vehicles', pagina: expect.any(String) }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByRole('table');
    expect(screen.getByText(/3 en flota/)).toBeInTheDocument();
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
