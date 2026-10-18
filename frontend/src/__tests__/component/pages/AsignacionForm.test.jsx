import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../services/asignaciones.service.js', () => ({
  asignacionesService: { get: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock('../../../services/vehicles.service.js', () => ({
  vehiclesService: { list: vi.fn().mockResolvedValue({ data: [] }) },
}));
vi.mock('../../../services/users.service.js', () => ({
  usersService: { list: vi.fn().mockResolvedValue({ data: [] }) },
}));
vi.mock('../../../services/trabajos.service.js', () => ({
  trabajosService: { get: vi.fn().mockResolvedValue({ horario: [] }) },
}));
import { trabajosService } from '../../../services/trabajos.service.js';

import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import AsignacionForm from '../../../pages/asignaciones/AsignacionForm.jsx';

const montar = (props) => render(
  <NotificationProvider>
    <AsignacionForm onSaved={vi.fn()} onClose={vi.fn()} {...props} />
  </NotificationProvider>
);

const EN_UN_DIA = new Date(Date.now() + 86400000).toISOString();
// Con miembros y evidencias ya cargados: el formulario no pide la ficha completa
const asig = (extra = {}) => ({
  id: 173, vehicle_id: 14, estado: 'activa', fecha_inicio: EN_UN_DIA, fecha_fin: EN_UN_DIA,
  inicio_real_at: null, llegada_servicio_at: null, km_inicio: null, notas: null,
  responsables: [{ id: 61 }], personal: [], evidencias: [], incidencias: [], ...extra,
});

// 2026-10-16, TRB-2026-0040: se guardó con la hora de inicio ya pasada y el
// cron la activó al minuto; al moverle la hora siguió activa.
describe('AsignacionForm · hora de inicio y vuelta a programada', () => {
  beforeEach(() => vi.clearAllMocks());

  it('al dar de alta con el inicio ya pasado avisa de que se activará sola', () => {
    const { container } = montar({ trabajo: { id: 40, nombre: 'Traslado' } });
    const [inicio] = container.querySelectorAll('input[type="datetime-local"]');
    fireEvent.change(inicio, { target: { value: '2020-01-01T10:00' } });
    expect(screen.getByTestId('aviso-inicio-pasado')).toHaveTextContent('se activará sola en un minuto');
    fireEvent.change(inicio, { target: { value: '2099-01-01T10:00' } });
    expect(screen.queryByTestId('aviso-inicio-pasado')).not.toBeInTheDocument();
  });

  it('una activa en la que nadie ha empezado explica que, con hora futura, vuelve a programada', () => {
    montar({ asignacion: asig() });
    expect(screen.getByTestId('activa-sin-empezar')).toHaveTextContent('vuelve a programada');
    expect(screen.queryByText(/Servicio en curso/)).not.toBeInTheDocument();
  });

  it('con el servicio empezado sigue el aviso de siempre', () => {
    montar({ asignacion: asig({ inicio_real_at: new Date().toISOString() }) });
    expect(screen.queryByTestId('activa-sin-empezar')).not.toBeInTheDocument();
    expect(screen.getByText(/Servicio en curso/)).toBeInTheDocument();
  });

  it('con una foto subida, también', () => {
    montar({ asignacion: asig({ evidencias: [{ id: 1 }] }) });
    expect(screen.queryByTestId('activa-sin-empezar')).not.toBeInTheDocument();
  });

  it('a una activa no se le avisa de la hora pasada (ya no hay nada que activar)', () => {
    montar({ asignacion: asig({ fecha_inicio: '2020-01-01T09:00:00.000Z', inicio_real_at: '2020-01-01T09:00:00.000Z' }) });
    expect(screen.queryByTestId('aviso-inicio-pasado')).not.toBeInTheDocument();
  });
});

// Jornadas por día (v39): lo que hereda «Igual que el trabajo» al editar una
// ambulancia desde su ficha (sin el trabajo a mano) se pide al trabajo
describe('AsignacionForm · horario por días', () => {
  it('al pasar de horario propio a «Igual que el trabajo» enseña el horario del trabajo', async () => {
    trabajosService.get.mockResolvedValueOnce({ horario: [
      { inicio: '2026-10-20T08:00:00.000Z', fin: '2026-10-20T20:00:00.000Z' },
      { inicio: '2026-10-21T08:00:00.000Z', fin: '2026-10-21T20:00:00.000Z' },
    ] });
    montar({ asignacion: asig({ trabajo_id: 40, horario_propio: true, estado: 'programada',
      fecha_inicio: '2026-10-20T06:00:00.000Z', fecha_fin: '2026-10-21T21:00:00.000Z',
      jornadas: [{ id: 1, inicio: '2026-10-20T09:00:00.000Z', fin: '2026-10-20T13:00:00.000Z', inicio_real_at: null }] }) });

    fireEvent.click(await screen.findByLabelText('Igual que el trabajo'));
    expect(trabajosService.get).toHaveBeenCalledWith(40);
    expect(await screen.findByText(/Mar 20\/10: 10:00–22:00/)).toBeInTheDocument();
    expect(screen.getByText(/Mié 21\/10: 10:00–22:00/)).toBeInTheDocument();
    expect(screen.queryByText(/no tiene horario por días/)).not.toBeInTheDocument();
  });
});

