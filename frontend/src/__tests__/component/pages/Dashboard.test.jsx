import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../services/vehicles.service.js', () => ({ vehiclesService: { list: vi.fn() } }));
vi.mock('../../../services/users.service.js',    () => ({ usersService:    { list: vi.fn() } }));
vi.mock('../../../services/trabajos.service.js', () => ({ trabajosService: { list: vi.fn() } }));
vi.mock('../../../services/auth.service.js', () => ({
  authService: { login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));

import { vehiclesService }      from '../../../services/vehicles.service.js';
import { usersService }         from '../../../services/users.service.js';
import { trabajosService }      from '../../../services/trabajos.service.js';
import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import { AuthProvider }         from '../../../context/AuthContext.jsx';
import { PREFIJO }              from '../../../utils/sessionStorage.js';
import Dashboard                from '../../../pages/Dashboard.jsx';

const sinRed = () => Object.assign(new Error('Network Error'), { config: { method: 'get', url: '/vehicles' } });

function montar() {
  return render(
    <NotificationProvider>
      <AuthProvider>
        <MemoryRouter><Dashboard /></MemoryRouter>
      </AuthProvider>
    </NotificationProvider>
  );
}

// La etiqueta del contador (los accesos rápidos repiten «Vehículos»)
const tarjeta = (etiqueta) => screen.getAllByText(etiqueta)
  .find((el) => el.classList.contains('micro')).closest('.card');

// Con `Promise.all` un contador que fallaba dejaba el panel sin ninguno y
// «Sin trabajos» en Próximos trabajos (2026-10-11)
describe('Dashboard (admin) · un contador que no carga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem(PREFIJO + 'accessToken', 'tok');
    localStorage.setItem(PREFIJO + 'user', JSON.stringify({
      id: 1, username: 'u', nombre: 'Ana', roles: ['administrador'], permissions: ['manage_users'],
    }));
    usersService.list.mockResolvedValue({ data: [], pagination: { total: 6 } });
    trabajosService.list.mockResolvedValue({ data: [], pagination: { total: 1 } });
  });

  it('dice que no se pudo cargar en vez de un 0, y los demás salen', async () => {
    vehiclesService.list.mockRejectedValue(sinRed());
    montar();

    await screen.findAllByText('Usuarios');
    expect(within(tarjeta('Vehículos')).getByText('–')).toBeInTheDocument();
    expect(within(tarjeta('Vehículos')).getByText('No se pudo cargar')).toBeInTheDocument();
    expect(within(tarjeta('Usuarios')).getByText('6')).toBeInTheDocument();
    expect(screen.getAllByText('No se pudo cargar')).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(PREFIJO + 'erroresPendientes'))).toEqual([
      expect.objectContaining({ url: '/vehicles', mensaje: expect.stringContaining('Inicio (vehículos)') }),
    ]);
  });

  it('si fallan los próximos trabajos no dice «Sin trabajos»', async () => {
    vehiclesService.list.mockResolvedValue({ data: [], pagination: { total: 4 } });
    trabajosService.list.mockImplementation(({ limit }) => (limit === 6
      ? Promise.reject(sinRed())
      : Promise.resolve({ data: [], pagination: { total: 1 } })));
    montar();

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar los trabajos');
    expect(screen.queryByText('Sin trabajos')).not.toBeInTheDocument();
    expect(within(tarjeta('Vehículos')).getByText('4')).toBeInTheDocument();
  });
});
