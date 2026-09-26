import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../services/flota.service.js', () => ({
  flotaService: { getUbicaciones: vi.fn() },
}));
// Leaflet no pinta en jsdom: basta con saber qué vehículo recibe seleccionado.
vi.mock('../../../components/flota/MapaLeaflet.jsx', () => ({
  default: ({ seleccionada }) => <div data-testid="mapa" data-seleccionada={seleccionada ?? ''} />,
}));

import { flotaService }         from '../../../services/flota.service.js';
import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import MapaFlota                from '../../../pages/flota/MapaFlota.jsx';

const DATOS = {
  flota: [
    { clave: 'v-1', vehiculoId: 1, alias: 'Ambulancia 1', matricula: '1111AAA', estado: 'apagado',
      gps: { lat: 40, lng: -3 } },
    { clave: 'v-2', vehiculoId: 2, alias: 'Ambulancia 2', matricula: '2222BBB', estado: 'movimiento',
      gps: { lat: 41, lng: -4 } },
  ],
  resumen: { vinculados: 2, sinGps: 0, sinVehiculo: 0, ambiguos: 0 },
  fuente: { configurado: true, origen: 'api' },
  minutosSinSenal: 30,
};

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
      <MemoryRouter initialEntries={[url]}><MapaFlota /></MemoryRouter>
    </NotificationProvider>
  );
  expect(flotaService.getUbicaciones).toHaveBeenCalledTimes(1);
  await act(() => flotaService.getUbicaciones.mock.results[0].value);
  return vista;
}

describe('MapaFlota · ?vehiculo=', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
