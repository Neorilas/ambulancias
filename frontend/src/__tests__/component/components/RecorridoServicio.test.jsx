import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/flota.service.js', () => ({
  flotaService: { getRecorrido: vi.fn() },
}));
// Leaflet no pinta en jsdom: basta con saber qué recibe el mapa
vi.mock('../../../components/flota/MapaRecorrido.jsx', () => ({
  default: ({ recorrido }) => <div data-testid="mapa" data-tramos={recorrido.tramos.length} />,
}));

import { flotaService } from '../../../services/flota.service.js';
import RecorridoServicio from '../../../components/flota/RecorridoServicio.jsx';

const ventana = { desde: '2026-10-17T06:00:00.000Z', hasta: '2026-10-17T20:00:00.000Z', enCurso: false, recortado: false, maxDias: 7 };
const ok = {
  estado: 'ok',
  ventana,
  recorrido: {
    tramos: [[[40, -3.7], [40.1, -3.7]]],
    inicio: { lat: 40, lng: -3.7, at: '2026-10-17T06:14:44.000Z' },
    fin: { lat: 40.1, lng: -3.7, at: '2026-10-17T19:57:38.000Z' },
    km: 596.9,
    puntos: 2508,
  },
  fuente: { configurado: true, error: null },
};

describe('RecorridoServicio', () => {
  beforeEach(() => { flotaService.getRecorrido.mockReset(); });

  it('no llama a Cartrack al abrir el panel, solo al pulsar «Ver recorrido»', async () => {
    flotaService.getRecorrido.mockResolvedValue(ok);
    render(<RecorridoServicio asignacionId={7} />);
    expect(flotaService.getRecorrido).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Ver recorrido' }));

    expect(flotaService.getRecorrido).toHaveBeenCalledWith(7);
    expect(await screen.findByTestId('mapa')).toHaveAttribute('data-tramos', '1');
    expect(screen.getByText(/596,9 km/)).toBeInTheDocument();
  });

  it('sin GPS vinculado lo dice, no pinta un mapa vacío', async () => {
    flotaService.getRecorrido.mockResolvedValue({ ...ok, estado: 'sin_gps', recorrido: { ...ok.recorrido, tramos: [] } });
    render(<RecorridoServicio asignacionId={7} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver recorrido' }));
    expect(await screen.findByText(/no tiene GPS vinculado/)).toBeInTheDocument();
    expect(screen.queryByTestId('mapa')).not.toBeInTheDocument();
  });

  it('Cartrack caído no se confunde con «no se movió»', async () => {
    flotaService.getRecorrido.mockResolvedValue({
      ...ok, recorrido: { ...ok.recorrido, tramos: [] }, fuente: { configurado: true, error: 'Cartrack no respondió a tiempo' },
    });
    render(<RecorridoServicio asignacionId={7} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver recorrido' }));
    await waitFor(() => expect(screen.getByText(/no contesta ahora mismo/)).toBeInTheDocument());
    expect(screen.queryByText(/no tiene puntos/)).not.toBeInTheDocument();
  });

  it('un servicio de más de 7 días avisa de que solo enseña los últimos', async () => {
    flotaService.getRecorrido.mockResolvedValue({ ...ok, ventana: { ...ventana, recortado: true } });
    render(<RecorridoServicio asignacionId={7} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver recorrido' }));
    expect(await screen.findByText(/solo los últimos 7 días/)).toBeInTheDocument();
  });
});
