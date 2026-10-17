import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';

vi.mock('../../../services/trabajos.service.js', () => ({
  trabajosService: { list: vi.fn(), listCalendario: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../../context/AuthContext.jsx', () => ({
  useAuth: () => ({ canManageTrabajos: () => false, canDeleteAny: () => false }),
}));

import { trabajosService }      from '../../../services/trabajos.service.js';
import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import TrabajoList              from '../../../pages/trabajos/TrabajoList.jsx';

// La ficha vuelve con navigate(-1), como el «‹» de TrabajoDetail
function Ficha() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <>
      <p>ficha {pathname}</p>
      <button onClick={() => navigate(-1)}>‹ volver</button>
    </>
  );
}

// Dónde se está, y el «atrás» del navegador
function Donde() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  return (
    <>
      <p data-testid="donde">{pathname}{search}</p>
      <button onClick={() => navigate(-1)}>atrás</button>
    </>
  );
}

function montar(ruta) {
  return render(
    <NotificationProvider>
      <MemoryRouter initialEntries={['/inicio', ruta]} initialIndex={1}>
        <Routes>
          <Route path="/inicio" element={<p>inicio</p>} />
          <Route path="/trabajos" element={<TrabajoList />} />
          <Route path="/trabajos/:id" element={<Ficha />} />
        </Routes>
        <Donde />
      </MemoryRouter>
    </NotificationProvider>
  );
}

const ultimaCarga = () => act(() => trabajosService.listCalendario.mock.results.at(-1).value);

describe('TrabajoList: el calendario sobrevive a abrir un trabajo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trabajosService.list.mockResolvedValue({ data: [], pagination: { total: 0, totalPages: 1 } });
  });

  it('«‹» desde la ficha vuelve al calendario, al mismo día, y no a la lista', async () => {
    const user = userEvent.setup();
    // Hoy, en la hora del dispositivo: es el mes que abre el calendario
    const hoy = new Date();
    const a = (h) => new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), h).toISOString();
    trabajosService.listCalendario.mockResolvedValue([
      { id: 5, nombre: 'Maratón', identificador: 'T-5', estado: 'programado', fecha_inicio: a(10), fecha_fin: a(12) },
    ]);

    montar('/trabajos');
    await user.click(await screen.findByRole('button', { name: 'Calendario' }));
    await ultimaCarga();
    await user.click(screen.getByRole('button', { name: String(hoy.getDate()) }));
    await user.click(screen.getByRole('button', { name: /Maratón/ }));
    expect(screen.getByText('ficha /trabajos/5')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '‹ volver' }));
    await ultimaCarga();
    expect(screen.getByRole('button', { name: 'Calendario' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: String(hoy.getDate()) })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Maratón/ })).toBeInTheDocument();

    // Mirar el calendario no deja rastro en el historial: un «atrás» más
    // sale de /trabajos, no recorre la vista y los días que se miraron
    await user.click(screen.getByRole('button', { name: 'atrás' }));
    expect(screen.getByText('inicio')).toBeInTheDocument();
  });

  it('«Lista» vuelve a la lista; el calendario se queda apuntado para volver a él', async () => {
    const user = userEvent.setup();
    trabajosService.listCalendario.mockResolvedValue([]);

    montar('/trabajos?vista=calendario&mes=2026-09&dia=2026-09-03');
    await ultimaCarga();
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    expect(screen.getByTestId('donde')).toHaveTextContent(/^\/trabajos\?mes=2026-09&dia=2026-09-03$/);
    expect(screen.getByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('el mes y el día de la URL; cambiar de mes lo apunta sin perder el día', async () => {
    const user = userEvent.setup();
    trabajosService.listCalendario.mockResolvedValue([
      { id: 7, nombre: 'Feria', identificador: 'T-7', estado: 'activo',
        fecha_inicio: '2026-09-03T08:00:00', fecha_fin: '2026-09-03T18:00:00' },
    ]);

    montar('/trabajos?vista=calendario&mes=2026-09&dia=2026-09-03');
    await ultimaCarga();
    expect(trabajosService.listCalendario).toHaveBeenCalledWith({ year: 2026, month: 9 });
    expect(screen.getByRole('button', { name: '3' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Feria/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    await ultimaCarga();
    expect(trabajosService.listCalendario).toHaveBeenLastCalledWith({ year: 2026, month: 10 });
    expect(screen.getByTestId('donde')).toHaveTextContent('/trabajos?vista=calendario&mes=2026-10&dia=2026-09-03');
  });

  it('sin mes en la URL, abre el del día elegido; pinchar el día otra vez lo suelta', async () => {
    const user = userEvent.setup();
    trabajosService.listCalendario.mockResolvedValue([]);

    montar('/trabajos?vista=calendario&dia=2026-02-14');
    await ultimaCarga();
    expect(trabajosService.listCalendario).toHaveBeenCalledWith({ year: 2026, month: 2 });

    await user.click(screen.getByRole('button', { name: '14' }));
    expect(screen.getByTestId('donde')).toHaveTextContent(/^\/trabajos\?vista=calendario$/);
  });

  it('un mes o un día mal formados en la URL se ignoran', async () => {
    trabajosService.listCalendario.mockResolvedValue([]);
    const hoy = new Date();

    montar('/trabajos?vista=calendario&mes=2026-13&dia=2026-02-30');
    await ultimaCarga();
    expect(trabajosService.listCalendario).toHaveBeenCalledWith({ year: hoy.getFullYear(), month: hoy.getMonth() + 1 });
    expect(screen.queryByRole('button', { pressed: true, name: /^\d+$/ })).not.toBeInTheDocument();
  });
});

describe('TrabajoList: la lista sobrevive a abrir un trabajo', () => {
  const pagina = (n) => ({
    data: [{ id: 40 + n, nombre: `Trabajo de la página ${n}`, estado: 'activo', tipo: 'traslado',
             identificador: `T-${n}`, fecha_inicio: '2026-10-11T08:00:00Z', fecha_fin: '2026-10-11T10:00:00Z',
             num_vehiculos: 1, num_usuarios: 2 }],
    pagination: { total: 30, totalPages: 2, hasPrev: n > 1, hasNext: n < 2 },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    trabajosService.list.mockImplementation(({ page }) => Promise.resolve(pagina(page)));
  });

  it('«‹» desde la ficha vuelve a la misma página y con los mismos filtros', async () => {
    const user = userEvent.setup();
    montar('/trabajos');
    await screen.findByText('Trabajo de la página 1');

    await user.selectOptions(screen.getByDisplayValue('Todos los estados'), 'activo');
    await user.click(screen.getByRole('button', { name: 'Siguiente ›' }));
    await user.click(await screen.findByText('Trabajo de la página 2'));
    expect(screen.getByText('ficha /trabajos/42')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '‹ volver' }));
    expect(await screen.findByText('Trabajo de la página 2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Activo')).toBeInTheDocument();
    expect(trabajosService.list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, estado: 'activo' }));

    // Ni las páginas ni los filtros dejan rastro: un «atrás» más sale
    await user.click(screen.getByRole('button', { name: 'atrás' }));
    expect(screen.getByText('inicio')).toBeInTheDocument();
  });

  it('cambiar un filtro vuelve a la página 1', async () => {
    const user = userEvent.setup();
    montar('/trabajos?page=2');
    await screen.findByText('Trabajo de la página 2');
    await user.selectOptions(screen.getByDisplayValue('Todos los tipos'), 'traslado');
    expect(screen.getByTestId('donde')).toHaveTextContent(/^\/trabajos\?tipo=traslado$/);
    expect(await screen.findByText('Trabajo de la página 1')).toBeInTheDocument();
  });

  // El Dashboard enlaza a `/trabajos?estado=activo`: hasta 2026-10-11 el
  // listado no leía la URL y enseñaba todos
  it('el filtro de la URL se aplica: el enlace «activos» del Dashboard', async () => {
    montar('/trabajos?estado=activo');
    await screen.findByText('Trabajo de la página 1');
    expect(trabajosService.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, estado: 'activo' }));
    expect(screen.getByDisplayValue('Activo')).toBeInTheDocument();
  });
});

describe('TrabajoList: coordinador y ambulancias bajo el ID', () => {
  const fila = (coordinadores_nombres, vehiculos_nombres) => ({
    id: 7, nombre: 'Maratón', estado: 'activo', tipo: 'traslado', identificador: 'T-7',
    fecha_inicio: '2026-10-11T08:00:00Z', fecha_fin: '2026-10-11T10:00:00Z',
    num_vehiculos: 2, num_usuarios: 2, coordinadores_nombres, vehiculos_nombres,
    num_coordinadores: (coordinadores_nombres || '').split(', ').length,
  });

  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['un coordinador y una ambulancia', 'Carla Ruiz', 'UVI-05', 'Carla Ruiz · UVI-05'],
    ['varios coordinadores (v35) y dos ambulancias', 'Carla Ruiz, Pablo Gil', 'UVI-04|UVI-03',
      'Carla Ruiz, Pablo Gil · UVI-04 y UVI-03'],
    ['solo ambulancias', null, 'UVI-04|UVI-03', 'UVI-04 y UVI-03'],
    ['solo coordinador', 'Carla Ruiz', '', 'Carla Ruiz'],
  ])('con %s, solo eso', async (_n, coordinadores, vehiculos, texto) => {
    trabajosService.list.mockResolvedValue({ data: [fila(coordinadores, vehiculos)], pagination: { total: 1, totalPages: 1 } });
    montar('/trabajos');
    expect((await screen.findByTestId('coordina-y-ambulancias')).textContent).toBe(texto);
    // Los recuentos ya no salen
    expect(screen.queryByText(/ambulancia\(s\)|persona\(s\)/)).not.toBeInTheDocument();
  });

  it('sin coordinador ni ambulancias, no pinta la línea', async () => {
    trabajosService.list.mockResolvedValue({ data: [fila(null, '')], pagination: { total: 1, totalPages: 1 } });
    montar('/trabajos');
    await screen.findByText('Maratón');
    expect(screen.queryByTestId('coordina-y-ambulancias')).not.toBeInTheDocument();
  });
});

// «A revisar» por el fin del evento (2026-10-11): la oficina lo ve en el
// listado sin entrar en el trabajo. El backend manda el recuento (o null a
// quien no le toca) y filtra con `revisar=fin_evento`.
describe('TrabajoList: ambulancias «A revisar»', () => {
  const fila = (id, asignaciones_a_revisar) => ({
    id, nombre: `Trabajo ${id}`, estado: 'finalizado', tipo: 'traslado', identificador: `T-${id}`,
    fecha_inicio: '2026-10-11T08:00:00Z', fecha_fin: '2026-10-11T10:00:00Z',
    num_vehiculos: 2, num_usuarios: 3, asignaciones_a_revisar,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    trabajosService.list.mockResolvedValue({
      data: [fila(1, 2), fila(2, 1), fila(3, 0), fila(4, null)], pagination: { total: 4, totalPages: 1 },
    });
  });

  it('marca los trabajos con «Tiempos que no cuadran», con cuántas ambulancias en el title', async () => {
    montar('/trabajos');
    await screen.findByText('Trabajo 1');
    const marcas = screen.getAllByTestId('trabajo-a-revisar');
    expect(marcas.map(m => m.textContent)).toEqual(['Tiempos que no cuadran', 'Tiempos que no cuadran']);
    expect(marcas[0].title).toMatch(/^2 ambulancias en las que/);
    expect(marcas[1].title).toMatch(/^1 ambulancia en las que/);
  });

  it('el botón «Tiempos que no cuadran» filtra, va en la URL y vuelve a la página 1', async () => {
    const user = userEvent.setup();
    montar('/trabajos?page=2&estado=finalizado');
    await screen.findByText('Trabajo 1');
    await user.click(screen.getByRole('button', { name: 'Tiempos que no cuadran' }));
    expect(screen.getByTestId('donde')).toHaveTextContent(/^\/trabajos\?estado=finalizado&revisar=fin_evento$/);
    expect(trabajosService.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, estado: 'finalizado', revisar: 'fin_evento' }));
    expect(screen.getByRole('button', { name: 'Tiempos que no cuadran' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Tiempos que no cuadran' }));
    expect(trabajosService.list).toHaveBeenLastCalledWith(expect.objectContaining({ revisar: undefined }));
  });
});
