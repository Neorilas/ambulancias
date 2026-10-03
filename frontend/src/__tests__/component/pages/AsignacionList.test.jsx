import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('../../../services/asignaciones.service.js', () => ({
  asignacionesService: { list: vi.fn(), delete: vi.fn(), activar: vi.fn() },
}));
// El detalle tiene su propia lógica: aquí solo importa cuál se abre y que cierre.
vi.mock('../../../pages/asignaciones/AsignacionDetalle.jsx', () => ({
  default: ({ id, onClose }) => (
    <div>
      <p>detalle {id}</p>
      <button onClick={onClose}>cerrar-detalle</button>
    </div>
  ),
}));
vi.mock('../../../pages/asignaciones/AsignacionForm.jsx', () => ({ default: () => null }));

import { asignacionesService }  from '../../../services/asignaciones.service.js';
import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import AsignacionList           from '../../../pages/asignaciones/AsignacionList.jsx';

function Url() {
  const { search } = useLocation();
  return <p data-testid="url">{search}</p>;
}

function montar(url) {
  return render(
    <NotificationProvider>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/asignaciones" element={<><AsignacionList /><Url /></>} />
        </Routes>
      </MemoryRouter>
    </NotificationProvider>
  );
}

// `?id=` es como enlazan a una asignación la ficha del vehículo, el mapa de
// flota y la alarma de «sin iniciar» (`rutaAsignacion`).
describe('AsignacionList · ?id=', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asignacionesService.list.mockResolvedValue({ data: [], pagination: { total: 0 } });
  });

  it('abre el detalle de la asignación pedida', async () => {
    montar('/asignaciones?id=44');
    expect(await screen.findByText('detalle 44')).toBeInTheDocument();
  });

  it('al cerrarlo quita el id de la URL', async () => {
    const user = userEvent.setup();
    montar('/asignaciones?id=44');
    await user.click(await screen.findByRole('button', { name: 'cerrar-detalle' }));

    expect(screen.queryByText('detalle 44')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('url')).toBeEmptyDOMElement());
  });

  it('sin parámetro no abre ninguno', async () => {
    montar('/asignaciones');
    await waitFor(() => expect(asignacionesService.list).toHaveBeenCalled());
    expect(screen.queryByText(/^detalle/)).not.toBeInTheDocument();
  });
});

// El número es lo que se dicen por teléfono y lo que sale en el detalle, los
// avisos y la ficha del vehículo («Asignación #N»): sin él no se cruzan.
describe('AsignacionList · número', () => {
  it('cada fila enseña su número', async () => {
    asignacionesService.list.mockResolvedValue({
      data: [{
        id: 123, estado: 'activa', vehiculo_alias: 'AMB 1', matricula: '1234ABC',
        responsable_nombre: 'Jose Lopez', responsable_username: 'jlopez',
        fecha_inicio: '2026-10-03T08:00:00Z', fecha_fin: null,
      }],
      pagination: { total: 1 },
    });
    montar('/asignaciones');
    expect(await screen.findByText('#123')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Nº' })).toBeInTheDocument();
    expect(screen.queryByText('Km inicio')).not.toBeInTheDocument();
  });
});
