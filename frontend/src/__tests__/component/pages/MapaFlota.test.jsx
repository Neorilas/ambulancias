import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

function montar(url) {
  return render(
    <NotificationProvider>
      <MemoryRouter initialEntries={[url]}><MapaFlota /></MemoryRouter>
    </NotificationProvider>
  );
}

describe('MapaFlota · ?vehiculo=', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flotaService.getUbicaciones.mockResolvedValue(DATOS);
  });

  it('abre con el vehículo pedido seleccionado y su ficha a la vista', async () => {
    montar('/flota?vehiculo=2');

    expect(await screen.findByRole('heading', { name: 'Ambulancia 2' })).toBeInTheDocument();
    expect(screen.getByTestId('mapa')).toHaveAttribute('data-seleccionada', 'v-2');
  });

  it('sin parámetro no selecciona ninguno', async () => {
    montar('/flota');

    await screen.findByText('Ambulancia 1');
    expect(screen.getByTestId('mapa')).toHaveAttribute('data-seleccionada', '');
  });
});
