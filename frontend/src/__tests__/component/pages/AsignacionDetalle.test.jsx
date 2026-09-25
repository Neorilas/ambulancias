import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../services/asignaciones.service.js', () => ({
  asignacionesService: { get: vi.fn(), crearIncidencia: vi.fn() },
}));
vi.mock('../../../services/vehicles.service.js', () => ({
  vehiclesService: { list: vi.fn().mockResolvedValue({ data: [] }) },
}));
vi.mock('../../../services/users.service.js', () => ({
  usersService: { list: vi.fn().mockResolvedValue({ data: [] }) },
}));
vi.mock('../../../services/auth.service.js', () => ({
  authService: { login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));

import { asignacionesService }  from '../../../services/asignaciones.service.js';
import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import { AuthProvider }         from '../../../context/AuthContext.jsx';
import { PREFIJO }              from '../../../utils/sessionStorage.js';
import { formatDateTime }       from '../../../utils/dateUtils.js';
import AsignacionDetalle        from '../../../pages/asignaciones/AsignacionDetalle.jsx';

const BASE = {
  id: 5, vehicle_id: 7, user_id: 2, estado: 'finalizada',
  vehiculo_alias: 'Ambulancia 3', matricula: '1234BCD',
  responsable_nombre: 'Jose Lopez', responsable_username: 'jlopez',
  fecha_inicio: '2026-09-21T06:00:00.000Z', fecha_fin: '2026-09-21T14:00:00.000Z',
  inicio_real_at: '2026-09-21T06:07:00.000Z', finalizado_at: '2026-09-21T14:23:00.000Z',
  km_inicio: 1000, km_fin: 1100,
  evidencias: [], incidencias: [],
  progreso: { inicio: { completado: 7, total: 7 }, fin: { completado: 7, total: 7 } },
};

function montar() {
  return render(
    <NotificationProvider>
      <AuthProvider>
        <AsignacionDetalle id={5} onClose={() => {}} />
      </AuthProvider>
    </NotificationProvider>
  );
}

describe('AsignacionDetalle — horas reales', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(PREFIJO + 'accessToken', 'tok');
    localStorage.setItem(PREFIJO + 'user', JSON.stringify({
      id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_trabajos'],
    }));
  });

  it('muestra la hora real de fin junto a la de inicio', async () => {
    asignacionesService.get.mockResolvedValue(BASE);
    montar();

    expect(await screen.findByText('Fin real de servicio')).toBeInTheDocument();
    expect(screen.getByText(formatDateTime(BASE.finalizado_at))).toBeInTheDocument();
    expect(screen.getByText(formatDateTime(BASE.inicio_real_at))).toBeInTheDocument();
  });

  it('en una asignación aún abierta el fin real sale como guion', async () => {
    asignacionesService.get.mockResolvedValue({ ...BASE, estado: 'activa', finalizado_at: null });
    montar();

    const etiqueta = await screen.findByText('Fin real de servicio');
    expect(etiqueta.nextElementSibling).toHaveTextContent('—');
  });

  it('sin ninguna hora real no pinta la fila', async () => {
    asignacionesService.get.mockResolvedValue({
      ...BASE, estado: 'programada', inicio_real_at: null, finalizado_at: null,
    });
    montar();

    await screen.findByText('Fin previsto');
    expect(screen.queryByText('Fin real de servicio')).not.toBeInTheDocument();
  });
});

describe('AsignacionDetalle — editar', () => {
  const ACTIVA_CON_FOTOS = {
    ...BASE, estado: 'activa', finalizado_at: null, notas: 'Llevar camilla',
    responsables: [{ id: 2, nombre: 'Jose', apellidos: 'Lopez', username: 'jlopez' }],
    personal: [],
    evidencias: [{ id: 9, tipo_imagen: 'delantera', momento: 'inicio', image_url: 'x.jpg' }],
    progreso: { inicio: { completado: 7, total: 7, completo: true }, fin: { completado: 0, total: 7 } },
  };

  function comoUsuario(u) {
    localStorage.clear();
    localStorage.setItem(PREFIJO + 'accessToken', 'tok');
    localStorage.setItem(PREFIJO + 'user', JSON.stringify(u));
  }

  it('gestión puede editar una activa con las fotos de inicio ya subidas', async () => {
    comoUsuario({ id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_trabajos'] });
    asignacionesService.get.mockResolvedValue(ACTIVA_CON_FOTOS);
    montar();

    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }));
    expect(await screen.findByText('Editar asignación')).toBeInTheDocument();
    expect(screen.getByText(/Servicio en curso/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Llevar camilla')).toBeInTheDocument();
  });

  it('una finalizada no se edita', async () => {
    comoUsuario({ id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_trabajos'] });
    asignacionesService.get.mockResolvedValue(BASE);
    montar();

    await screen.findByText('Fin real de servicio');
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });

  it('el técnico responsable no ve el botón', async () => {
    comoUsuario({ id: 2, username: 'jlopez', roles: ['tecnico'], permissions: [] });
    asignacionesService.get.mockResolvedValue(ACTIVA_CON_FOTOS);
    montar();

    await screen.findByText('Fin previsto');
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });
});
