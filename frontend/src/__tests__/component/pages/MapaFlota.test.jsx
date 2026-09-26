import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('../../../services/flota.service.js', () => ({
  flotaService: { getUbicaciones: vi.fn() },
}));
// Leaflet no pinta en jsdom: basta con saber qué vehículo recibe seleccionado
// y poder pulsar el enlace del globo como lo haría quien pincha el marcador.
vi.mock('../../../components/flota/MapaLeaflet.jsx', () => ({
  default: ({ seleccionada, onAbrirAsignacion }) => (
    <div data-testid="mapa" data-seleccionada={seleccionada ?? ''}>
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
  return <p>destino {pathname}{search}</p>;
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
          <Route path="/flota" element={<MapaFlota />} />
          <Route path="/asignaciones" element={<Destino />} />
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
