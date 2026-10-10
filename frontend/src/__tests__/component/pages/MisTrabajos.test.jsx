import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('../../../services/trabajos.service.js', () => ({
  trabajosService: { misTrab: vi.fn(), miCalendario: vi.fn() },
}));

import { trabajosService }      from '../../../services/trabajos.service.js';
import { NotificationProvider, useNotification } from '../../../context/NotificationContext.jsx';
import MisTrabajos              from '../../../pages/MisTrabajos.jsx';
import { diaEnEspana }          from '../../../utils/dateUtils.js';

function Destino() {
  const { pathname, search } = useLocation();
  return <p>destino {pathname}{search}</p>;
}

// El provider guarda los avisos pero no los pinta (eso lo hace el Layout)
function Avisos() {
  const { toasts } = useNotification();
  return toasts.map(t => <p key={t.id}>{t.message}</p>);
}

function montar(ruta = '/mis-trabajos') {
  return render(
    <NotificationProvider>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/mis-trabajos" element={<MisTrabajos />} />
          <Route path="/trabajos/:id" element={<Destino />} />
        </Routes>
      </MemoryRouter>
      <Avisos />
    </NotificationProvider>
  );
}

const ahora = Date.now();
const iso = (ms) => new Date(ahora + ms).toISOString();

// D7: la portada del técnico son tarjetas por trabajo con «Ver trabajo»
describe('MisTrabajos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
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

  it('trabajo del modelo anterior con dos vehículos suyos: en plural', async () => {
    trabajosService.misTrab.mockResolvedValue({ data: [
      { id: 6, nombre: 'Feria antigua', estado: 'activo', fecha_inicio: iso(-3600e3), fecha_fin: iso(3600e3),
        soy_coordinador: false, en_equipo: false, mi_asignacion: null, mis_vehiculos_v25: 'UVI-9, SVB-3' },
    ] });
    montar();
    const [feria] = await screen.findAllByTestId('tarjeta-trabajo');
    expect(feria).toHaveTextContent('Tus vehículos: UVI-9, SVB-3 · pendiente de cerrar');
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

  // ── Vista de calendario (2026-10-11) ──────────────────────
  describe('calendario', () => {
    const ENTRADAS = [
      { trabajo_id: 1, nombre: 'Maratón', ubicacion: 'Retiro', trabajo_estado: 'finalizado',
        asignacion_id: 11, asignacion_estado: 'finalizada', vehiculo: 'UVI-1', mi_papel: 'responsable',
        fecha_inicio: '2026-09-03T06:00:00Z', fecha_fin: '2026-09-03T12:00:00Z' },
      { trabajo_id: 3, nombre: 'Feria', ubicacion: null, trabajo_estado: 'finalizado',
        asignacion_id: null, asignacion_estado: null, vehiculo: null, mi_papel: 'coordinador',
        fecha_inicio: '2026-09-02T08:00:00Z', fecha_fin: '2026-09-04T18:00:00Z' },
    ];
    const ultimaCarga = () => act(() => trabajosService.miCalendario.mock.results.at(-1).value);

    // Se espera a la promesa del servicio dentro de act (gotcha de §3.4 del mapa)
    async function montarCalendario(ruta) {
      const vista = montar(ruta);
      await ultimaCarga();
      return vista;
    }

    beforeEach(() => {
      trabajosService.miCalendario.mockResolvedValue(ENTRADAS);
    });

    it('la lista sigue siendo lo de siempre: el calendario no se pide', async () => {
      montar();
      await screen.findByText('Maratón');
      expect(trabajosService.miCalendario).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('el día de la URL: su mes, lo de ese día y qué pinta en cada uno', async () => {
      await montarCalendario('/mis-trabajos?vista=calendario&dia=2026-09-03');
      expect(trabajosService.miCalendario).toHaveBeenCalledWith({ year: 2026, month: 9 });
      expect(trabajosService.misTrab).not.toHaveBeenCalled();
      expect(screen.getByText('Septiembre 2026')).toBeInTheDocument();
      expect(screen.getByText('Jueves, 3 de septiembre')).toBeInTheDocument();

      const entradas = screen.getAllByTestId('entrada-calendario');
      expect(entradas).toHaveLength(2);
      expect(entradas[0]).toHaveTextContent('Maratón');
      expect(entradas[0]).toHaveTextContent('08:00 – 14:00');
      expect(entradas[0]).toHaveTextContent('Llevas UVI-1 · Retiro');
      expect(entradas[1]).toHaveTextContent('Feria');
      expect(entradas[1]).toHaveTextContent('02/09 10:00 → 04/09 20:00');
      expect(entradas[1]).toHaveTextContent('Coordinas este trabajo');

      // El día 3 lleva dos; el 1, ninguno
      expect(screen.getByRole('button', { name: '3 de septiembre, 2 trabajos' }))
        .toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: '1 de septiembre' })).toBeInTheDocument();
    });

    it('cada entrada abre su trabajo, con su ambulancia señalada', async () => {
      const user = userEvent.setup();
      await montarCalendario('/mis-trabajos?vista=calendario&dia=2026-09-03');
      await user.click(screen.getAllByTestId('entrada-calendario')[0]);
      expect(await screen.findByText('destino /trabajos/1?asignacion=11')).toBeInTheDocument();
    });

    it('sin ambulancia, abre el trabajo sin más', async () => {
      const user = userEvent.setup();
      await montarCalendario('/mis-trabajos?vista=calendario&dia=2026-09-03');
      await user.click(screen.getAllByTestId('entrada-calendario')[1]);
      expect(await screen.findByText('destino /trabajos/3')).toBeInTheDocument();
    });

    it('elegir otro día enseña lo suyo; un día vacío lo dice', async () => {
      const user = userEvent.setup();
      await montarCalendario('/mis-trabajos?vista=calendario&dia=2026-09-03');
      await user.click(screen.getByRole('button', { name: '4 de septiembre, 1 trabajo' }));
      expect(screen.getAllByTestId('entrada-calendario')).toHaveLength(1);
      await user.click(screen.getByRole('button', { name: '10 de septiembre' }));
      expect(screen.queryByTestId('entrada-calendario')).not.toBeInTheDocument();
      expect(screen.getByText('Nada este día')).toBeInTheDocument();
    });

    it('cambiar de mes pide el nuevo y se queda en su día 1', async () => {
      const user = userEvent.setup();
      await montarCalendario('/mis-trabajos?vista=calendario&dia=2026-09-03');
      trabajosService.miCalendario.mockResolvedValue([]);
      await user.click(screen.getByRole('button', { name: 'Mes anterior' }));
      await ultimaCarga();
      expect(trabajosService.miCalendario).toHaveBeenLastCalledWith({ year: 2026, month: 8 });
      expect(screen.getByRole('button', { name: '1 de agosto' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('un mes sin nada lo dice', async () => {
      trabajosService.miCalendario.mockResolvedValue([]);
      await montarCalendario('/mis-trabajos?vista=calendario&dia=2026-08-10');
      expect(screen.getByText('Este mes no tienes trabajos')).toBeInTheDocument();
    });

    it('la vista elegida se recuerda: la próxima vez abre en calendario, en el día de hoy', async () => {
      const user = userEvent.setup();
      const { unmount } = montar();
      await screen.findByText('Maratón');
      await user.click(screen.getByRole('button', { name: 'Calendario' }));
      await ultimaCarga();
      unmount();

      await montarCalendario('/mis-trabajos');
      expect(screen.getByRole('button', { name: 'Calendario' })).toHaveAttribute('aria-pressed', 'true');
      const hoy = diaEnEspana(new Date());
      expect(trabajosService.miCalendario).toHaveBeenLastCalledWith({
        year: Number(hoy.slice(0, 4)), month: Number(hoy.slice(5, 7)),
      });
    });

    it('si falla la carga, avisa y no se queda cargando', async () => {
      trabajosService.miCalendario.mockRejectedValue(new Error('sin red'));
      montar('/mis-trabajos?vista=calendario&dia=2026-09-03');
      expect(await screen.findByText('Error al cargar el calendario')).toBeInTheDocument();
      expect(screen.getByText('Este mes no tienes trabajos')).toBeInTheDocument();
    });
  });
});
