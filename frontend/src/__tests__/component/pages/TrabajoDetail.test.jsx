import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../services/trabajos.service.js', () => ({
  trabajosService: { get: vi.fn(), cerrar: vi.fn() },
}));
vi.mock('../../../services/auth.service.js', () => ({
  authService: { login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));
// La operación de cada ambulancia tiene sus propios tests: aquí solo importa
// cuál se abre.
vi.mock('../../../pages/asignaciones/AsignacionDetalle.jsx', () => ({
  default: ({ id, desdeTrabajo }) => <p>detalle {id}{desdeTrabajo ? ' desde trabajo' : ''}</p>,
}));
vi.mock('../../../pages/asignaciones/AsignacionForm.jsx', () => ({
  default: ({ trabajo }) => <p>alta de ambulancia en {trabajo.nombre}</p>,
}));
vi.mock('../../../pages/trabajos/TrabajoForm.jsx', () => ({ default: () => null }));

import { trabajosService }      from '../../../services/trabajos.service.js';
import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import { AuthProvider }         from '../../../context/AuthContext.jsx';
import { PREFIJO }              from '../../../utils/sessionStorage.js';
import TrabajoDetail            from '../../../pages/trabajos/TrabajoDetail.jsx';

const T0 = Date.now();
const iso = (ms) => new Date(T0 + ms).toISOString();

// Lo que manda el backend a quien lleva la ambulancia A: la suya entera; de B,
// solo cuál es y quién va (vistaParaUsuario).
const MIA = {
  id: 201, vehicle_id: 7, estado: 'activa', mi_rol: 'responsable', detalle: true,
  vehiculo_alias: 'UVI-1', matricula: '7777AAA', fecha_inicio: iso(-3600e3), fecha_fin: iso(3600e3),
  inicio_real_at: iso(-3000e3), llegada_servicio_at: null, fin_servicio_at: null,
  progreso_fotos: { inicio: { completado: 7, total: 7, completo: true }, fin: { completado: 0, total: 5, completo: false } },
  responsables: [{ id: 20, nombre: 'Ana', apellidos: 'Ruiz' }], personal: [{ id: 30, nombre: 'Eva', apellidos: 'Gil' }],
};
const AJENA = {
  id: 202, vehicle_id: 8, vehiculo_alias: 'SVB-2', matricula: '8888BBB', mi_rol: null, detalle: false,
  responsables: [{ id: 21, nombre: 'Luis', apellidos: 'Gil' }], personal: [],
};
const TRABAJO = {
  id: 1, identificador: 'TRB-2026-0002', nombre: 'Maratón', estado: 'activo', tipo: 'cobertura_evento',
  descripcion: 'Cobertura de la carrera', ubicacion: 'Retiro',
  fecha_inicio: iso(-3600e3), fecha_fin: iso(3600e3),
  coordinador_user_id: 50, coordinador: { id: 50, nombre: 'Carla', apellidos: 'Ruiz' },
  mi_rol: 'responsable', puede_cerrar: false,
  asignaciones: [MIA, AJENA], vehiculos: [], usuarios: [], evidencias: [],
};

function comoUsuario(u) {
  localStorage.clear();
  localStorage.setItem(PREFIJO + 'accessToken', 'tok');
  localStorage.setItem(PREFIJO + 'user', JSON.stringify(u));
}
const TECNICO = { id: 20, username: 'ana', roles: ['tecnico'], permissions: [] };
const GESTOR  = { id: 2, username: 'gestor', roles: ['gestor'], permissions: ['manage_trabajos', 'view_all_trabajos'] };

function montar(url = '/trabajos/1') {
  return render(
    <NotificationProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/trabajos/:id" element={<TrabajoDetail />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </NotificationProvider>
  );
}

describe('TrabajoDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    comoUsuario(TECNICO);
    trabajosService.get.mockResolvedValue(TRABAJO);
  });

  it('la ficha del trabajo: descripción, ubicación y quién coordina', async () => {
    montar();
    expect(await screen.findByText('Cobertura de la carrera')).toBeInTheDocument();
    expect(screen.getByText('Retiro')).toBeInTheDocument();
    expect(screen.getByText('Carla Ruiz')).toBeInTheDocument();
  });

  it('«Tu ambulancia» con el siguiente paso, que abre la operación de siempre (D7)', async () => {
    const user = userEvent.setup();
    montar();
    const tuya = await screen.findByTestId('tu-ambulancia');
    expect(tuya).toHaveTextContent('UVI-1');
    expect(tuya).toHaveTextContent('En camino');
    await user.click(within(tuya).getByRole('button', { name: 'Inicio evento/servicio' }));
    expect(await screen.findByText('detalle 201 desde trabajo')).toBeInTheDocument();
  });

  it('al equipo: «Lo lleva …» y sin botón de acción', async () => {
    comoUsuario({ id: 30, username: 'eva', roles: ['enfermero'], permissions: [] });
    trabajosService.get.mockResolvedValue({
      ...TRABAJO, mi_rol: 'equipo', asignaciones: [{ ...MIA, mi_rol: 'equipo' }, AJENA],
    });
    montar();
    const tuya = await screen.findByTestId('tu-ambulancia');
    expect(tuya).toHaveTextContent('Vas en el equipo. Lo lleva Ana Ruiz.');
    expect(within(tuya).getByRole('button')).toHaveTextContent('Ver detalle');
  });

  it('una ambulancia ajena enseña quién va, pero no se abre', async () => {
    montar();
    await screen.findByTestId('tu-ambulancia');
    expect(screen.getByText(/Luis Gil/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /SVB-2/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /UVI-1/ })).toBeInTheDocument();
  });

  it('?asignacion= señala esa ambulancia (los avisos y la alarma llevan aquí, D10)', async () => {
    montar('/trabajos/1?asignacion=201');
    const boton = await screen.findByRole('button', { name: /UVI-1/ });
    expect(boton.className).toContain('border-primary-400');
  });

  it('pendiente de cierre: el coordinador lo cierra tras confirmar (D3)', async () => {
    const user = userEvent.setup();
    comoUsuario({ id: 50, username: 'carla', roles: [], permissions: [] });
    trabajosService.get.mockResolvedValue({
      ...TRABAJO, estado: 'pendiente_cierre', mi_rol: 'coordinador', puede_cerrar: true,
      asignaciones: [{ ...MIA, mi_rol: null, estado: 'finalizada' }, { ...AJENA, detalle: true, estado: 'finalizada' }],
    });
    trabajosService.cerrar.mockResolvedValue({ ...TRABAJO, estado: 'finalizado', cerrado_at: iso(0), asignaciones: [] });
    montar();

    await user.click(await screen.findByRole('button', { name: 'Cerrar trabajo' }));
    // El de confirmar es el del diálogo, el último en pintarse
    expect(await screen.findByText(/Al cerrarlo desaparece de la portada/)).toBeInTheDocument();
    const botones = screen.getAllByRole('button', { name: 'Cerrar trabajo' });
    await user.click(botones[botones.length - 1]);
    expect(trabajosService.cerrar).toHaveBeenCalledWith(1);
    expect(await screen.findByText(/cerrado el/)).toBeInTheDocument();
  });

  it('pendiente de cierre visto por quien no lo cierra: dice quién falta', async () => {
    trabajosService.get.mockResolvedValue({ ...TRABAJO, estado: 'pendiente_cierre', puede_cerrar: false });
    montar();
    expect(await screen.findByText('Falta que lo cierre Carla Ruiz.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cerrar trabajo' })).not.toBeInTheDocument();
  });

  it('gestión añade ambulancias desde aquí (D9)', async () => {
    const user = userEvent.setup();
    comoUsuario(GESTOR);
    trabajosService.get.mockResolvedValue({ ...TRABAJO, mi_rol: 'gestion' });
    montar();
    await user.click(await screen.findByRole('button', { name: '+ Añadir ambulancia' }));
    expect(screen.getByText('alta de ambulancia en Maratón')).toBeInTheDocument();
  });

  it('el técnico no ve «Añadir ambulancia» ni «Editar»', async () => {
    montar();
    await screen.findByTestId('tu-ambulancia');
    expect(screen.queryByRole('button', { name: '+ Añadir ambulancia' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });
});
