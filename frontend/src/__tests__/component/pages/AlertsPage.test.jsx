import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';

vi.mock('../../../services/vehicles.service.js', () => ({
  vehiclesService: { listAlertas: vi.fn() },
}));

import { vehiclesService }      from '../../../services/vehicles.service.js';
import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import AlertsPage               from '../../../pages/AlertsPage.jsx';

function Ficha() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p>ficha {pathname}</p>
      <button onClick={() => navigate(-1)}>volver</button>
    </>
  );
}

function Url() {
  const { pathname, search } = useLocation();
  return <p data-testid="url">{pathname}{search}</p>;
}

function montar(ruta = '/alertas') {
  return render(
    <NotificationProvider>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/alertas" element={<><AlertsPage /><Url /></>} />
          <Route path="/vehiculos/:id" element={<Ficha />} />
        </Routes>
      </MemoryRouter>
    </NotificationProvider>
  );
}

const enDias = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const ALERTAS = [
  { vehicle_id: 3, alias: 'Ambulancia 3', matricula: '4444DDD', tipo: 'tarjeta_transporte',
    fecha_caducidad: enDias(-10), dias_restantes: -10 },
  { vehicle_id: 5, alias: 'Ambulancia 5', matricula: '5555EEE', tipo: 'itv',
    fecha_caducidad: enDias(40), dias_restantes: 40 },
];
const ultimaCarga = () => act(() => vehiclesService.listAlertas.mock.results.at(-1).value);

// Navegación con continuidad (§8 del mapa, «La navegación hacia atrás»)
describe('AlertsPage · «Ver vehículo» y los filtros', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vehiclesService.listAlertas.mockResolvedValue(ALERTAS);
  });

  // Hasta 2026-10-11 llevaba a /vehiculos, el listado, y había que buscarlo
  it('«Ver vehículo» lleva a la ficha de ESE vehículo', async () => {
    montar();
    await ultimaCarga();
    const enlaces = screen.getAllByRole('link', { name: 'Ver vehículo' }).map(a => a.getAttribute('href'));
    expect(enlaces).toContain('/vehiculos/3');
    expect(enlaces).toContain('/vehiculos/5');
    expect(enlaces).not.toContain('/vehiculos');
  });

  it('los filtros van en la URL y siguen puestos al volver de la ficha', async () => {
    const user = userEvent.setup();
    montar();
    await ultimaCarga();
    await user.selectOptions(screen.getByDisplayValue('Todos'), 'itv');
    expect(screen.getByTestId('url')).toHaveTextContent('/alertas?tipo=itv');

    await user.click(screen.getAllByRole('link', { name: 'Ver vehículo' })[0]);
    expect(screen.getByText('ficha /vehiculos/5')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'volver' }));
    await ultimaCarga();

    expect(screen.getByDisplayValue('ITV')).toBeInTheDocument();
    expect(screen.queryByText('4444DDD')).not.toBeInTheDocument();
  });
});

describe('AlertsPage · mantenimiento por km', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vehiclesService.listAlertas.mockResolvedValue([
      ...ALERTAS,
      { vehicle_id: 8, alias: 'Ambulancia 8', matricula: '8888HHH', tipo: 'mantenimiento',
        km_objetivo: 45000, km_actuales: 44200, km_restantes: 800,
        fecha_caducidad: null, dias_restantes: null },
    ]);
  });

  it('sale con los km que faltan y a cuántos toca, no con días', async () => {
    montar();
    await ultimaCarga();
    expect(screen.getAllByText('800 km').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/a los 45.?000 km/).length).toBeGreaterThan(0);
  });

  it('su KPI filtra solo las de mantenimiento', async () => {
    const user = userEvent.setup();
    montar();
    await ultimaCarga();
    await user.click(screen.getByRole('button', { name: /Mantenimiento ≤ 2.000 km/ }));

    expect(screen.getByTestId('url')).toHaveTextContent('umbral=km');
    expect(screen.getAllByText('8888HHH').length).toBeGreaterThan(0);
    expect(screen.queryByText('5555EEE')).not.toBeInTheDocument();
  });
});
