import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';

vi.mock('../../../services/flota.service.js', () => ({
  // Por defecto, sin recorrido: los tests de selección no van de eso
  flotaService: {
    getUbicaciones: vi.fn(),
    getRecorrido: vi.fn(() => Promise.resolve({ estado: 'sin_gps', recorrido: { tramos: [] }, fuente: {} })),
  },
}));
// Leaflet no pinta en jsdom: basta con saber qué vehículo recibe seleccionado
// y poder pulsar el enlace del globo como lo haría quien pincha el marcador.
vi.mock('../../../components/flota/MapaLeaflet.jsx', () => ({
  default: ({ seleccionada, onAbrirAsignacion, recorrido }) => (
    <div data-testid="mapa" data-seleccionada={seleccionada ?? ''}
         data-recorrido={recorrido ? `${recorrido.id}:${recorrido.tramos.length}` : ''}>
      {onAbrirAsignacion && (
        <button onClick={() => onAbrirAsignacion(55)}>globo-asignacion</button>
      )}
    </div>
  ),
}));
// Los flags se fijan por test: `menu_asignaciones` decide si la asignación se
// enlaza o solo se nombra.
const flags = vi.hoisted(() => ({ activos: [] }));
vi.mock('../../../context/FeaturesContext.jsx', () => ({
  useFeatures: () => ({ isFeatureEnabled: (k) => flags.activos.includes(k) }),
}));

import { flotaService }         from '../../../services/flota.service.js';
import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import MapaFlota                from '../../../pages/flota/MapaFlota.jsx';

const DATOS = {
  flota: [
    { clave: 'v-1', vehiculoId: 1, alias: 'Ambulancia 1', matricula: '1111AAA', estado: 'apagado',
      gps: { lat: 40, lng: -3 } },
    { clave: 'v-2', vehiculoId: 2, alias: 'Ambulancia 2', matricula: '2222BBB', estado: 'movimiento',
      gps: { lat: 41, lng: -4 },
      asignacion: { id: 55, responsable: 'Jose Lopez', iniciada: true } },
  ],
  resumen: { vinculados: 2, sinGps: 0, sinVehiculo: 0, ambiguos: 0 },
  fuente: { configurado: true, origen: 'api' },
  minutosSinSenal: 30,
};

function Destino() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p>destino {pathname}{search}</p>
      <button onClick={() => navigate(-1)}>volver</button>
    </>
  );
}

function Url() {
  const { pathname, search } = useLocation();
  return <p data-testid="url">{pathname}{search}</p>;
}

/**
 * Monta la página y espera a que termine la PRIMERA carga, con todo lo que
 * desencadena (setDatos → efecto de `?vehiculo=` → setSeleccionada → render).
 *
 * No se usa `findBy*`: sondea contra un reloj de 1 s, y con la suite entera en
 * paralelo el render llegaba a pasarse (fallaba ~1 de cada 5 `vitest run`).
 * Esperar a la promesa del servicio dentro de `act` no depende del reloj: al
 * salir del `act`, React ya ha aplicado todas las actualizaciones pendientes.
 */
async function montar(url) {
  const vista = render(
    <NotificationProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/flota" element={<><MapaFlota /><Url /></>} />
          <Route path="/asignaciones" element={<Destino />} />
          <Route path="/vehiculos/:id" element={<Destino />} />
        </Routes>
      </MemoryRouter>
    </NotificationProvider>
  );
  expect(flotaService.getUbicaciones).toHaveBeenCalledTimes(1);
  await act(() => flotaService.getUbicaciones.mock.results[0].value);
  return vista;
}

describe('MapaFlota · ?vehiculo=', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags.activos = [];
    flotaService.getUbicaciones.mockResolvedValue(DATOS);
  });

  it('abre con el vehículo pedido seleccionado y su ficha a la vista', async () => {
    await montar('/flota?vehiculo=2');

    expect(screen.getByRole('heading', { name: 'Ambulancia 2' })).toBeInTheDocument();
    expect(screen.getByTestId('mapa')).toHaveAttribute('data-seleccionada', 'v-2');
  });

  it('sin parámetro no selecciona ninguno', async () => {
    await montar('/flota');

    expect(screen.getByText('Ambulancia 1')).toBeInTheDocument();
    expect(screen.getByTestId('mapa')).toHaveAttribute('data-seleccionada', '');
  });
});

// Filtro, búsqueda y elegida en la URL: la ficha del mapa lleva a la del
// vehículo y al volver tiene que seguir elegida y filtrada (§8 del mapa)
describe('MapaFlota · lo elegido sobrevive a ir a la ficha del vehículo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags.activos = [];
    flotaService.getUbicaciones.mockResolvedValue(DATOS);
  });

  it('elegir y filtrar se apuntan; al volver de la ficha sigue igual', async () => {
    const user = userEvent.setup();
    await montar('/flota');
    await user.click(screen.getByRole('button', { name: /En movimiento/ }));
    await user.click(screen.getByRole('button', { name: /Ambulancia 2/ }));
    expect(screen.getByTestId('url')).toHaveTextContent('/flota?filtro=movimiento&vehiculo=2');

    await user.click(screen.getByRole('link', { name: 'Ver ficha del vehículo' }));
    expect(screen.getByText('destino /vehiculos/2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'volver' }));
    await act(() => flotaService.getUbicaciones.mock.results.at(-1).value);

    expect(screen.getByTestId('mapa')).toHaveAttribute('data-seleccionada', 'v-2');
    expect(screen.getByRole('heading', { name: 'Ambulancia 2' })).toBeInTheDocument();
    // El filtro sigue puesto: la 1 está apagada y no sale
    expect(screen.queryByText('Ambulancia 1')).not.toBeInTheDocument();
  });

  it('buscar filtra al momento y la búsqueda queda en la URL', async () => {
    const user = userEvent.setup();
    await montar('/flota');
    await user.type(screen.getByRole('searchbox'), '2222');
    expect(screen.getByRole('searchbox')).toHaveValue('2222');
    expect(screen.queryByText('Ambulancia 1')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('url')).toHaveTextContent('/flota?q=2222'));
  });

  it('cerrar la ficha la quita de la URL', async () => {
    const user = userEvent.setup();
    await montar('/flota?vehiculo=2');
    await user.click(screen.getByRole('button', { name: 'Cerrar ficha' }));
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/flota$/);
    expect(screen.getByTestId('mapa')).toHaveAttribute('data-seleccionada', '');
  });
});

describe('MapaFlota · asignación activa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags.activos = ['menu_asignaciones'];
    flotaService.getUbicaciones.mockResolvedValue(DATOS);
  });

  it('la lista la nombra junto al responsable', async () => {
    await montar('/flota');
    expect(screen.getByText(/Asignación #55 · Jose Lopez/)).toBeInTheDocument();
  });

  it('la ficha del vehículo enlaza a su detalle', async () => {
    await montar('/flota?vehiculo=2');
    const enlace = screen.getByRole('link', { name: /Asignación #55/ });
    expect(enlace).toHaveAttribute('href', '/asignaciones?id=55');
  });

  it('el globo del marcador navega al detalle', async () => {
    const user = userEvent.setup();
    await montar('/flota');
    await user.click(screen.getByRole('button', { name: 'globo-asignacion' }));
    expect(await screen.findByText('destino /asignaciones?id=55')).toBeInTheDocument();
  });

  it('sin menu_asignaciones la nombra pero no la enlaza', async () => {
    flags.activos = [];
    await montar('/flota?vehiculo=2');
    expect(screen.getByRole('heading', { name: 'Ambulancia 2' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Asignación #55/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'globo-asignacion' })).not.toBeInTheDocument();
  });
});

// Pinchar una ambulancia con servicio activo pinta su recorrido en el mismo
// mapa (pedido del usuario, 2026-10-20)
describe('MapaFlota · recorrido del servicio activo', () => {
  const RECORRIDO = {
    estado: 'ok',
    ventana: { desde: '2026-10-20T06:00:00.000Z', hasta: '2026-10-20T10:00:00.000Z', enCurso: true, recortado: false, maxDias: 7 },
    recorrido: {
      tramos: [[[40, -3], [40.1, -3]], [[41, -4], [41.1, -4]]],
      inicio: { lat: 40, lng: -3, at: '2026-10-20T06:10:00.000Z' },
      fin: { lat: 41.1, lng: -4, at: '2026-10-20T09:59:00.000Z' },
      km: 42.5, puntos: 900,
    },
    fuente: { configurado: true, error: null },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    flags.activos = [];
    flotaService.getUbicaciones.mockResolvedValue(DATOS);
    flotaService.getRecorrido.mockResolvedValue(RECORRIDO);
  });

  it('al elegir una con asignación activa pide su recorrido y lo pasa al mapa', async () => {
    const user = userEvent.setup();
    await montar('/flota');
    await user.click(screen.getByRole('button', { name: /Ambulancia 2/ }));

    expect(flotaService.getRecorrido).toHaveBeenCalledWith(55);
    await waitFor(() => expect(screen.getByTestId('mapa')).toHaveAttribute('data-recorrido', '55:2'));
    expect(screen.getByText(/42,5 km/)).toBeInTheDocument();
  });

  it('sin asignación activa no se pide nada y no queda línea de la anterior', async () => {
    const user = userEvent.setup();
    await montar('/flota');
    await user.click(screen.getByRole('button', { name: /Ambulancia 2/ }));
    await waitFor(() => expect(screen.getByTestId('mapa')).toHaveAttribute('data-recorrido', '55:2'));

    await user.click(screen.getByRole('button', { name: /Ambulancia 1/ }));
    expect(screen.getByTestId('mapa')).toHaveAttribute('data-recorrido', '');
    expect(flotaService.getRecorrido).toHaveBeenCalledTimes(1);
  });
});
