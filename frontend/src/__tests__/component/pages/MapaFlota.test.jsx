import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

function montar(url) {
  return render(
    <NotificationProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/flota" element={<MapaFlota />} />
          <Route path="/asignaciones" element={<Destino />} />
        </Routes>
      </MemoryRouter>
    </NotificationProvider>
  );
}

describe('MapaFlota · ?vehiculo=', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags.activos = [];
    flotaService.getUbicaciones.mockResolvedValue(DATOS);
  });

  it('abre con el vehículo pedido seleccionado y su ficha a la vista', async () => {
    montar('/flota?vehiculo=2');

    // Margen sobre el segundo por defecto: con la suite entera y cobertura
    // este primer render llegó a pasar de 1 s.
    expect(await screen.findByRole('heading', { name: 'Ambulancia 2' }, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByTestId('mapa')).toHaveAttribute('data-seleccionada', 'v-2');
  });

  it('sin parámetro no selecciona ninguno', async () => {
    montar('/flota');

    await screen.findByText('Ambulancia 1');
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
    montar('/flota');
    expect(await screen.findByText(/Asignación #55 · Jose Lopez/)).toBeInTheDocument();
  });

  it('la ficha del vehículo enlaza a su detalle', async () => {
    montar('/flota?vehiculo=2');
    const enlace = await screen.findByRole('link', { name: /Asignación #55/ });
    expect(enlace).toHaveAttribute('href', '/asignaciones?id=55');
  });

  it('el globo del marcador navega al detalle', async () => {
    const user = userEvent.setup();
    montar('/flota');
    await user.click(await screen.findByRole('button', { name: 'globo-asignacion' }));
    expect(await screen.findByText('destino /asignaciones?id=55')).toBeInTheDocument();
  });

  it('sin menu_asignaciones la nombra pero no la enlaza', async () => {
    flags.activos = [];
    montar('/flota?vehiculo=2');
    await screen.findByRole('heading', { name: 'Ambulancia 2' });
    expect(screen.queryByRole('link', { name: /Asignación #55/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'globo-asignacion' })).not.toBeInTheDocument();
  });
});
