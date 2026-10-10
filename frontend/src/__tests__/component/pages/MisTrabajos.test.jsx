import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('../../../services/trabajos.service.js', () => ({
  trabajosService: { misTrab: vi.fn() },
}));

import { trabajosService }      from '../../../services/trabajos.service.js';
import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import MisTrabajos              from '../../../pages/MisTrabajos.jsx';

function Destino() {
  const { pathname } = useLocation();
  return <p>destino {pathname}</p>;
}

function montar() {
  return render(
    <NotificationProvider>
      <MemoryRouter initialEntries={['/mis-trabajos']}>
        <Routes>
          <Route path="/mis-trabajos" element={<MisTrabajos />} />
          <Route path="/trabajos/:id" element={<Destino />} />
        </Routes>
      </MemoryRouter>
    </NotificationProvider>
  );
}

const ahora = Date.now();
const iso = (ms) => new Date(ahora + ms).toISOString();

// D7: la portada del técnico son tarjetas por trabajo con «Ver trabajo»
describe('MisTrabajos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trabajosService.misTrab.mockResolvedValue({ data: [
      { id: 1, nombre: 'Maratón', estado: 'activo', ubicacion: 'Retiro',
        fecha_inicio: iso(-3600e3), fecha_fin: iso(3600e3), soy_coordinador: false,
        mi_asignacion: { id: 11, estado: 'activa', mi_rol: 'responsable', vehiculo_alias: 'UVI-1',
                         inicio_real_at: iso(-3000e3), llegada_servicio_at: iso(-2000e3) } },
      { id: 2, nombre: 'Concierto', estado: 'programado',
        fecha_inicio: iso(5 * 86400e3), fecha_fin: iso(5 * 86400e3 + 3600e3), soy_coordinador: false,
        mi_asignacion: { id: 12, estado: 'programada', mi_rol: 'equipo', vehiculo_alias: 'SVB-2',
                         fecha_inicio: iso(5 * 86400e3), responsables_nombres: 'Luis Gil' } },
      { id: 3, nombre: 'Feria', estado: 'pendiente_cierre',
        fecha_inicio: iso(-86400e3), fecha_fin: iso(-3600e3), soy_coordinador: true, mi_asignacion: null },
    ] });
  });

  it('hoy arriba (en marcha o pendiente de cierre) y los próximos debajo', async () => {
    montar();
    await screen.findByText('Maratón');
    const tarjetas = screen.getAllByTestId('tarjeta-trabajo').map(t => t.textContent);
    expect(tarjetas[0]).toContain('Maratón');
    expect(tarjetas[1]).toContain('Feria');
    expect(tarjetas[2]).toContain('Concierto');
    expect(screen.getByText('Hoy')).toBeInTheDocument();
    expect(screen.getByText('Próximos')).toBeInTheDocument();
  });

  it('«Tu ambulancia» con su estado; al equipo, quién la lleva; al coordinador, que lo cierre', async () => {
    montar();
    await screen.findByText('Maratón');
    const [maraton, feria, concierto] = screen.getAllByTestId('tarjeta-trabajo');
    expect(maraton).toHaveTextContent('Tu ambulancia: UVI-1 · En el evento/servicio');
    expect(concierto).toHaveTextContent('Vas en el equipo. Lo lleva Luis Gil.');
    expect(feria).toHaveTextContent('Coordinas este trabajo: todas han terminado, falta que lo cierres');
  });

  it('la tarjeta no ejecuta nada: su único botón abre el trabajo', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByText('Maratón');
    const [maraton] = screen.getAllByTestId('tarjeta-trabajo');
    const botones = maraton.querySelectorAll('button');
    expect(botones).toHaveLength(1);
    expect(botones[0]).toHaveTextContent('Ver trabajo');
    await user.click(botones[0]);
    expect(await screen.findByText('destino /trabajos/1')).toBeInTheDocument();
  });

  it('sin trabajos lo dice', async () => {
    trabajosService.misTrab.mockResolvedValue({ data: [] });
    montar();
    expect(await screen.findByText('No tienes trabajos')).toBeInTheDocument();
  });

  it('trabajo del modelo anterior: dice qué vehículo tiene pendiente de cerrar', async () => {
    trabajosService.misTrab.mockResolvedValue({ data: [
      { id: 5, nombre: 'Feria antigua', estado: 'activo', fecha_inicio: iso(-3600e3), fecha_fin: iso(3600e3),
        soy_coordinador: false, en_equipo: false, mi_asignacion: null, mis_vehiculos_v25: 'UVI-9' },
    ] });
    montar();
    const [feria] = await screen.findAllByTestId('tarjeta-trabajo');
    expect(feria).toHaveTextContent('Tu vehículo: UVI-9 · pendiente de cerrar');
  });

  it('en el equipo del trabajo sin ambulancia: lo dice', async () => {
    trabajosService.misTrab.mockResolvedValue({ data: [
      { id: 4, nombre: 'Feria', estado: 'programado', fecha_inicio: iso(3600e3), fecha_fin: iso(7200e3),
        soy_coordinador: false, en_equipo: true, mi_asignacion: null },
    ] });
    montar();
    const [feria] = await screen.findAllByTestId('tarjeta-trabajo');
    expect(feria).toHaveTextContent('Estás en el equipo de este trabajo.');
  });
});
