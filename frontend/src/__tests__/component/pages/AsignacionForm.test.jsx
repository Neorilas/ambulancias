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
