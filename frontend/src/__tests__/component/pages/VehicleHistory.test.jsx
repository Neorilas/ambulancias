import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';

vi.mock('../../../services/vehicles.service.js', () => ({
  vehiclesService: {
    getHistory:      vi.fn(),
    get:             vi.fn(),
    update:          vi.fn(),
    listIncidencias: vi.fn(),
    listRevisiones:  vi.fn(),
    createRevision:  vi.fn(),
  },
}));

vi.mock('../../../services/users.service.js', () => ({
  usersService: { list: vi.fn() },
}));
vi.mock('../../../services/auth.service.js', () => ({
  authService: { login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));
// La ficha consulta los feature flags para decidir si ofrece «Ver en el mapa».
// Sin flags activos el botón no sale, que es lo que le toca a un administrador
// con `menu_flota` apagado.
vi.mock('../../../services/features.service.js', () => ({
  featuresService: { getActive: vi.fn().mockResolvedValue([]) },
}));
// Facturas de mantenimiento: solo las pide la ficha de un administrador.
vi.mock('../../../services/facturas.service.js', () => ({
  facturasService: { list: vi.fn().mockResolvedValue([]), leer: vi.fn(), subir: vi.fn(), descargar: vi.fn() },
}));

import { vehiclesService } from '../../../services/vehicles.service.js';
import { facturasService } from '../../../services/facturas.service.js';
import { featuresService } from '../../../services/features.service.js';
import { usersService }    from '../../../services/users.service.js';
import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import { AuthProvider }         from '../../../context/AuthContext.jsx';
import { FeaturesProvider }     from '../../../context/FeaturesContext.jsx';
import { PREFIJO }              from '../../../utils/sessionStorage.js';
import VehicleHistory           from '../../../pages/vehicles/VehicleHistory.jsx';

/** Deja en sesion un administrador con permiso para editar la flota. */
function sesionConPermiso() {
  localStorage.setItem(PREFIJO + 'accessToken', 'tok');
  localStorage.setItem(PREFIJO + 'user', JSON.stringify({
    id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_vehicles'],
  }));
}

const VEHICULO = {
  id: 7, matricula: '1234BCD', alias: 'Ambulancia 3',
  kilometros_actuales: 120000, fecha_matriculacion: '2019-01-10',
  fecha_itv: '2026-01-10', fecha_its: '2026-03-01',
  fecha_tarjeta_transporte: '2027-01-01', fecha_ultimo_servicio: '2026-09-01',
  images: [],
  asignaciones: { total: 12, activa: null },
};

// Dónde se está y el «atrás» del navegador, para la navegación
function Donde() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="donde">{pathname}{search}</p>
      <button onClick={() => navigate(-1)}>atrás del navegador</button>
    </>
  );
}

/** `entradas`: el historial; se abre en la última. */
function montar(entradas = ['/vehiculos/7']) {
  return render(
    <NotificationProvider>
      <AuthProvider>
        <FeaturesProvider>
          <MemoryRouter initialEntries={entradas} initialIndex={entradas.length - 1}>
            <Routes>
              <Route path="/vehiculos" element={<p>listado de vehículos</p>} />
              <Route path="/informes" element={<p>informes</p>} />
              <Route path="/vehiculos/:id" element={<VehicleHistory />} />
              <Route path="/vehiculos/:id/historial" element={<VehicleHistory />} />
            </Routes>
            <Donde />
          </MemoryRouter>
        </FeaturesProvider>
      </AuthProvider>
    </NotificationProvider>
  );
}

describe('VehicleHistory · peticiones de la ficha', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vehiclesService.getHistory.mockResolvedValue({ vehicle: VEHICULO, trabajos: [] });
    vehiclesService.get.mockResolvedValue(VEHICULO);
    vehiclesService.listIncidencias.mockResolvedValue([]);
    vehiclesService.listRevisiones.mockResolvedValue([]);
    usersService.list.mockResolvedValue({ data: [] });
  });

  it('pide cada juego de datos una sola vez al abrir la ficha', async () => {
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await waitFor(() => expect(vehiclesService.get).toHaveBeenCalledTimes(1));

    expect(vehiclesService.getHistory).toHaveBeenCalledTimes(1);
    expect(vehiclesService.listIncidencias).toHaveBeenCalledTimes(1);
    expect(vehiclesService.listRevisiones).toHaveBeenCalledTimes(1);
  });

  it('no trae los 300 empleados hasta que se abren las incidencias', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await waitFor(() => expect(vehiclesService.get).toHaveBeenCalledTimes(1));

    // Sólo los usa el selector de responsable de la pestaña de incidencias.
    expect(usersService.list).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Incidencias' }));
    await waitFor(() => expect(usersService.list).toHaveBeenCalledTimes(1));
  });

  // Las pestañas se desmontan al cambiar de una a otra: antes, cada vuelta
  // repetía la carga de datos que ya estaban en pantalla.
  it('no repite peticiones al pasearse por las pestañas', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await waitFor(() => expect(vehiclesService.get).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Incidencias' }));
    await user.click(screen.getByRole('button', { name: 'Revisiones' }));
    await user.click(screen.getByRole('button', { name: 'Fotos' }));
    await user.click(screen.getByRole('button', { name: 'Resumen' }));

    expect(vehiclesService.listIncidencias).toHaveBeenCalledTimes(1);
    expect(vehiclesService.listRevisiones).toHaveBeenCalledTimes(1);
    expect(vehiclesService.getHistory).toHaveBeenCalledTimes(1);
    expect(vehiclesService.get).toHaveBeenCalledTimes(1);
    expect(usersService.list).toHaveBeenCalledTimes(1);
  });
});

// Navegación con continuidad (§8 del mapa): la pestaña sobrevive a ir a un
// trabajo y volver, y «← Volver» es la pantalla de donde se vino
describe('VehicleHistory · navegación', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vehiclesService.getHistory.mockResolvedValue({ vehicle: VEHICULO, trabajos: [] });
    vehiclesService.get.mockResolvedValue(VEHICULO);
    vehiclesService.listIncidencias.mockResolvedValue([]);
    vehiclesService.listRevisiones.mockResolvedValue([]);
    usersService.list.mockResolvedValue({ data: [] });
  });

  it('la pestaña va en la URL, sin dejar rastro en el historial', async () => {
    const user = userEvent.setup();
    montar(['/informes', '/vehiculos/7']);
    await screen.findByRole('heading', { name: 'Ambulancia 3' });

    await user.click(screen.getByRole('button', { name: 'Revisiones' }));
    expect(screen.getByTestId('donde')).toHaveTextContent('/vehiculos/7?tab=revisiones');
    await user.click(screen.getByRole('button', { name: 'Resumen' }));
    expect(screen.getByTestId('donde')).toHaveTextContent(/^\/vehiculos\/7$/);

    await user.click(screen.getByRole('button', { name: 'atrás del navegador' }));
    expect(screen.getByText('informes')).toBeInTheDocument();
  });

  it('al volver a la ficha se abre en la pestaña en la que se estaba', async () => {
    montar(['/vehiculos/7?tab=incidencias']);
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    expect(screen.getByRole('button', { name: 'Incidencias' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('«← Volver» vuelve a la pantalla de donde se vino, no siempre al listado', async () => {
    const user = userEvent.setup();
    montar(['/informes?mes=2026-08', '/vehiculos/7']);
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await user.click(screen.getByRole('button', { name: '← Volver' }));
    expect(screen.getByTestId('donde')).toHaveTextContent('/informes?mes=2026-08');
  });

  it('sin pantalla anterior (un enlace, un aviso), «← Volver» lleva al listado', async () => {
    const user = userEvent.setup();
    montar(['/vehiculos/7']);
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await user.click(screen.getByRole('button', { name: '← Volver' }));
    expect(screen.getByText('listado de vehículos')).toBeInTheDocument();
  });
});

// Sin la hora no se puede seguir el estado del vehículo: dos fotos del mismo
// tipo (la frontal del inicio y la del fin) se ven iguales.
describe('VehicleHistory · hora de cada foto', () => {
  const GRUPO_CON_FOTOS = {
    tipo: 'asignacion', asignacion_id: 4, trabajo_id: null, referencia: null,
    nombre: null, estado: 'finalizada',
    fecha_inicio: '2026-09-18T05:00:00.000Z', fecha_fin: '2026-09-18T18:00:00.000Z',
    km_inicio: 120000, km_fin: 120240, responsable_nombre: 'Jose Lopez',
    fotos: [
      {
        id: 1, tipo_imagen: 'frontal', momento: 'inicio', image_url: '/u/i.jpg',
        fecha: '2026-09-18T06:10:00.000Z',
        subido_por: { id: 3, nombre: 'Jose', apellidos: 'Lopez', username: 'jlopez' },
      },
      {
        id: 2, tipo_imagen: 'frontal', momento: 'fin', image_url: '/u/f.jpg',
        fecha: '2026-09-18T17:40:00.000Z',
        subido_por: { id: 3, nombre: 'Jose', apellidos: 'Lopez', username: 'jlopez' },
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vehiclesService.getHistory.mockResolvedValue({ vehicle: VEHICULO, trabajos: [GRUPO_CON_FOTOS] });
    vehiclesService.get.mockResolvedValue(VEHICULO);
    vehiclesService.listIncidencias.mockResolvedValue([]);
    vehiclesService.listRevisiones.mockResolvedValue([]);
    usersService.list.mockResolvedValue({ data: [] });
  });

  it('pone día, hora española y momento en cada miniatura', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await user.click(screen.getByRole('button', { name: 'Fotos' }));

    // 06:10 UTC de septiembre son las 08:10 en España (CEST, +02:00)
    expect(await screen.findByText('18/09 08:10')).toBeInTheDocument();
    expect(screen.getByText('18/09 19:40')).toBeInTheDocument();
    expect(screen.getByText('Inicio')).toBeInTheDocument();
    expect(screen.getByText('Fin')).toBeInTheDocument();
  });

  // Una tanda de noche cruza la medianoche española antes que la UTC: 22:15Z
  // del 17 ya son las 00:15 del 18 en España. Por eso la miniatura lleva el día
  // y no solo la hora.
  it('pasa de día cuando la foto cruza la medianoche española', async () => {
    const user = userEvent.setup();
    vehiclesService.getHistory.mockResolvedValue({
      vehicle: VEHICULO,
      trabajos: [{
        ...GRUPO_CON_FOTOS,
        fotos: [
          { ...GRUPO_CON_FOTOS.fotos[0], fecha: '2026-09-17T21:50:00.000Z' },
          { ...GRUPO_CON_FOTOS.fotos[1], fecha: '2026-09-17T22:15:00.000Z' },
        ],
      }],
    });
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await user.click(screen.getByRole('button', { name: 'Fotos' }));

    expect(await screen.findByText('17/09 23:50')).toBeInTheDocument();
    expect(screen.getByText('18/09 00:15')).toBeInTheDocument();
  });

  it('el visor grande da la fecha completa con la hora', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await user.click(screen.getByRole('button', { name: 'Fotos' }));

    const miniaturas = await screen.findAllByRole('button', { name: /Frontal/ });
    await user.click(miniaturas[0]);

    expect(await screen.findByText(/Jose Lopez · 18\/09\/2026 08:10/)).toBeInTheDocument();
    expect(screen.getByText('Inicio · Frontal')).toBeInTheDocument();
  });
});

// El resumen habla de uso del vehiculo, no de cuantas fotos se subieron: el
// numero de fotos y el de trabajos con foto no le dicen nada a quien gestiona
// la flota. Lo que importa es cuantas veces ha salido y si ahora esta libre.
describe('VehicleHistory · resumen de asignaciones', () => {
  const GRUPO_CON_FOTOS = {
    tipo: 'asignacion', asignacion_id: 4, trabajo_id: null, estado: 'finalizada',
    fecha_inicio: '2026-09-18T05:00:00.000Z', fecha_fin: '2026-09-18T18:00:00.000Z',
    fotos: [{
      id: 1, tipo_imagen: 'frontal', momento: 'inicio', image_url: '/u/i.jpg',
      fecha: '2026-09-18T06:10:00.000Z', subido_por: { id: 3, nombre: 'Jose', apellidos: 'Lopez' },
    }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vehiclesService.getHistory.mockResolvedValue({ vehicle: VEHICULO, trabajos: [GRUPO_CON_FOTOS] });
    vehiclesService.get.mockResolvedValue(VEHICULO);
    vehiclesService.listIncidencias.mockResolvedValue([]);
    vehiclesService.listRevisiones.mockResolvedValue([]);
    usersService.list.mockResolvedValue({ data: [] });
  });

  it('cuenta las asignaciones historicas y no las fotos', async () => {
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });

    // Sale dos veces: en el vistazo de arriba y en la tarjeta de asignaciones.
    expect((await screen.findAllByText('Asignaciones históricas')).length).toBe(2);
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);

    expect(screen.queryByText('Fotos totales')).not.toBeInTheDocument();
    expect(screen.queryByText('Trabajos con fotos')).not.toBeInTheDocument();
    expect(screen.queryByText('Fotos registradas')).not.toBeInTheDocument();
  });

  it('dice que esta libre cuando no hay asignacion activa', async () => {
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });

    expect((await screen.findAllByText('Libre')).length).toBeGreaterThan(0);
  });

  it('dice quien la lleva cuando esta asignada ahora mismo', async () => {
    vehiclesService.get.mockResolvedValue({
      ...VEHICULO,
      asignaciones: {
        total: 13,
        activa: {
          id: 44, fecha_inicio: '2026-09-19T05:00:00.000Z', fecha_fin: '2026-09-20T05:00:00.000Z',
          inicio_real_at: '2026-09-19T05:10:00.000Z', responsable_nombre: 'Jose Lopez',
        },
      },
    });
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });

    expect((await screen.findAllByText('Asignada')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Jose Lopez/).length).toBeGreaterThan(0);
  });

  describe('enlace a la asignación activa', () => {
    const CON_ACTIVA = {
      ...VEHICULO,
      asignaciones: {
        total: 13,
        activa: {
          id: 44, fecha_inicio: '2026-09-19T05:00:00.000Z', fecha_fin: '2026-09-20T05:00:00.000Z',
          inicio_real_at: null, responsable_nombre: 'Jose Lopez',
        },
      },
    };

    it('la nombra en la cabecera y lleva a su detalle', async () => {
      sesionConPermiso();
      featuresService.getActive.mockResolvedValueOnce(['menu_asignaciones']);
      vehiclesService.get.mockResolvedValue(CON_ACTIVA);
      montar();

      const enlace = await screen.findByRole('link', { name: /Asignación #44/ });
      expect(enlace).toHaveAttribute('href', '/asignaciones?id=44');
    });

    it('sin acceso a /asignaciones la nombra pero no la enlaza', async () => {
      vehiclesService.get.mockResolvedValue(CON_ACTIVA);
      montar();

      expect(await screen.findByText('Asignación #44')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Asignación #44/ })).not.toBeInTheDocument();
    });

    it('libre, no nombra ninguna asignación', async () => {
      montar();
      await screen.findByRole('heading', { name: 'Ambulancia 3' });
      await waitFor(() => expect(vehiclesService.get).toHaveBeenCalled());

      expect(screen.queryByText(/Asignación #/)).not.toBeInTheDocument();
    });
  });
});

// Los datos del vehiculo se editan en el propio resumen. Cambiar de pestana a
// medias perdia lo escrito sin avisar: ahora se pregunta antes.
describe('VehicleHistory · edicion desde el resumen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sesionConPermiso();
    vehiclesService.getHistory.mockResolvedValue({ vehicle: VEHICULO, trabajos: [] });
    vehiclesService.get.mockResolvedValue(VEHICULO);
    vehiclesService.update.mockResolvedValue(VEHICULO);
    vehiclesService.listIncidencias.mockResolvedValue([]);
    vehiclesService.listRevisiones.mockResolvedValue([]);
    usersService.list.mockResolvedValue({ data: [] });
  });

  async function abrirEdicion(user) {
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await user.click(await screen.findByRole('button', { name: 'Editar' }));
    return screen.getByDisplayValue('Ambulancia 3');
  }

  it('guarda los cambios al pulsar Guardar cambios', async () => {
    const user = userEvent.setup();
    const nombre = await abrirEdicion(user);

    await user.clear(nombre);
    await user.type(nombre, 'Ambulancia 4');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(vehiclesService.update).toHaveBeenCalledTimes(1));
    expect(vehiclesService.update.mock.calls[0][1]).toMatchObject({
      alias: 'Ambulancia 4', matricula: '1234BCD',
    });
    // Tras guardar se recarga la ficha: la cabecera tiene que reflejarlo.
    expect(vehiclesService.get).toHaveBeenCalledTimes(2);
  });

  it('descarta lo escrito sin llamar al servidor', async () => {
    const user = userEvent.setup();
    const nombre = await abrirEdicion(user);

    await user.clear(nombre);
    await user.type(nombre, 'Ambulancia 4');
    await user.click(screen.getByRole('button', { name: 'Descartar' }));

    expect(vehiclesService.update).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue('Ambulancia 4')).not.toBeInTheDocument();
  });

  it('avisa al cambiar de pestana con cambios sin guardar', async () => {
    const user = userEvent.setup();
    const nombre = await abrirEdicion(user);

    await user.clear(nombre);
    await user.type(nombre, 'Ambulancia 4');
    await user.click(screen.getByRole('button', { name: 'Revisiones' }));

    expect(await screen.findByText('Cambios sin guardar')).toBeInTheDocument();
    // Sigue en el resumen hasta que se decida
    expect(screen.getByDisplayValue('Ambulancia 4')).toBeInTheDocument();
  });

  it('no avisa si no se ha tocado nada', async () => {
    const user = userEvent.setup();
    await abrirEdicion(user);

    await user.click(screen.getByRole('button', { name: 'Revisiones' }));

    expect(screen.queryByText('Cambios sin guardar')).not.toBeInTheDocument();
    expect(await screen.findByText('Sin revisiones registradas')).toBeInTheDocument();
  });

  it('descartar en el aviso cambia de pestana y pierde lo escrito', async () => {
    const user = userEvent.setup();
    const nombre = await abrirEdicion(user);

    await user.clear(nombre);
    await user.type(nombre, 'Ambulancia 4');
    await user.click(screen.getByRole('button', { name: 'Revisiones' }));
    await user.click(await screen.findByRole('button', { name: 'Descartar cambios' }));

    expect(vehiclesService.update).not.toHaveBeenCalled();
    expect(await screen.findByText('Sin revisiones registradas')).toBeInTheDocument();
  });

  it('guardar en el aviso guarda y luego cambia de pestana', async () => {
    const user = userEvent.setup();
    const nombre = await abrirEdicion(user);

    await user.clear(nombre);
    await user.type(nombre, 'Ambulancia 4');
    await user.click(screen.getByRole('button', { name: 'Revisiones' }));
    await user.click(await screen.findByRole('button', { name: 'Guardar y continuar' }));

    await waitFor(() => expect(vehiclesService.update).toHaveBeenCalledTimes(1));
    expect(vehiclesService.update.mock.calls[0][1]).toMatchObject({ alias: 'Ambulancia 4' });
    expect(await screen.findByText('Sin revisiones registradas')).toBeInTheDocument();
  });

  it('sin permiso para gestionar la flota no hay boton de editar', async () => {
    localStorage.clear();
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await waitFor(() => expect(vehiclesService.get).toHaveBeenCalledTimes(1));

    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });
});

// Bajar el km desde «Guardar y continuar» (cambio de pestaña con ediciones
// sin guardar) abre su propio aviso en vez de guardar sin más. Nació de un
// bug real: leer el estado de ese aviso justo tras el `await` de guardar()
// veía la foto de ANTES de abrirlo (React no la actualiza a mitad del mismo
// evento), así que el destino de navegación se perdía en silencio aunque el
// guardado funcionara.
describe('VehicleHistory · bajar km desde «Guardar y continuar»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sesionConPermiso();
    vehiclesService.getHistory.mockResolvedValue({ vehicle: VEHICULO, trabajos: [] });
    vehiclesService.get.mockResolvedValue(VEHICULO);
    vehiclesService.update.mockResolvedValue(VEHICULO);
    vehiclesService.listIncidencias.mockResolvedValue([]);
    vehiclesService.listRevisiones.mockResolvedValue([]);
    usersService.list.mockResolvedValue({ data: [] });
  });

  it('pregunta antes de guardar y, al confirmar, guarda y completa el cambio de pestaña', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await user.click(await screen.findByRole('button', { name: 'Editar' }));

    const km = screen.getByDisplayValue('120000');
    await user.clear(km);
    await user.type(km, '100000');
    await user.click(screen.getByRole('button', { name: 'Revisiones' }));
    await user.click(await screen.findByRole('button', { name: 'Guardar y continuar' }));

    // El aviso de bajar km sustituye al de cambios sin guardar, no se apilan.
    expect(await screen.findByText('Bajar el kilometraje')).toBeInTheDocument();
    expect(screen.queryByText('Has modificado los datos del vehículo')).not.toBeInTheDocument();
    expect(vehiclesService.update).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Sí, bajar el kilometraje' }));

    await waitFor(() => expect(vehiclesService.update).toHaveBeenCalledTimes(1));
    expect(vehiclesService.update.mock.calls[0][1].kilometros_actuales).toBe(100000);
    // El destino que quedó pendiente (Revisiones) se retoma tras confirmar.
    expect(await screen.findByText('Sin revisiones registradas')).toBeInTheDocument();
  });

  it('cancelar el aviso de km vuelve a mostrar el de cambios sin guardar', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await user.click(await screen.findByRole('button', { name: 'Editar' }));

    const km = screen.getByDisplayValue('120000');
    await user.clear(km);
    await user.type(km, '100000');
    await user.click(screen.getByRole('button', { name: 'Revisiones' }));
    await user.click(await screen.findByRole('button', { name: 'Guardar y continuar' }));
    await screen.findByText('Bajar el kilometraje');

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(vehiclesService.update).not.toHaveBeenCalled();
    expect(await screen.findByText('Cambios sin guardar')).toBeInTheDocument();
  });
});

// Vaciar los kilometros y guardar mandaba `kilometros_actuales: 0`, que el
// UPDATE escribia encima de la lectura real del cuentakilometros. Un campo en
// blanco es «no hay lectura nueva»: no debe viajar.
describe('VehicleHistory · el km en blanco no borra el contador', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sesionConPermiso();
    vehiclesService.getHistory.mockResolvedValue({ vehicle: VEHICULO, trabajos: [] });
    vehiclesService.get.mockResolvedValue(VEHICULO);
    vehiclesService.update.mockResolvedValue(VEHICULO);
    vehiclesService.listIncidencias.mockResolvedValue([]);
    vehiclesService.listRevisiones.mockResolvedValue([]);
    usersService.list.mockResolvedValue({ data: [] });
  });

  it('omite el campo del payload si se deja vacio', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await user.click(await screen.findByRole('button', { name: 'Editar' }));

    await user.clear(screen.getByDisplayValue('120000'));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(vehiclesService.update).toHaveBeenCalledTimes(1));
    const payload = vehiclesService.update.mock.calls[0][1];
    expect(payload).not.toHaveProperty('kilometros_actuales');
  });

  it('manda el numero cuando si hay lectura', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await user.click(await screen.findByRole('button', { name: 'Editar' }));

    const km = screen.getByDisplayValue('120000');
    await user.clear(km);
    await user.type(km, '121500');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(vehiclesService.update).toHaveBeenCalledTimes(1));
    expect(vehiclesService.update.mock.calls[0][1].kilometros_actuales).toBe(121500);
  });
});

// El aviso de cambios sin guardar es un modal a pantalla completa: si la
// validacion falla por detras, los campos en rojo quedan tapados y parece que
// el boton no hace nada.
describe('VehicleHistory · validacion con el aviso abierto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sesionConPermiso();
    vehiclesService.getHistory.mockResolvedValue({ vehicle: VEHICULO, trabajos: [] });
    vehiclesService.get.mockResolvedValue(VEHICULO);
    vehiclesService.update.mockResolvedValue(VEHICULO);
    vehiclesService.listIncidencias.mockResolvedValue([]);
    vehiclesService.listRevisiones.mockResolvedValue([]);
    usersService.list.mockResolvedValue({ data: [] });
  });

  it('cierra el aviso y ensena el error en vez de no hacer nada', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await user.click(await screen.findByRole('button', { name: 'Editar' }));

    // Nombre vacio: la validacion de cliente no deja guardar
    await user.clear(screen.getByDisplayValue('Ambulancia 3'));
    await user.click(screen.getByRole('button', { name: 'Revisiones' }));
    await user.click(await screen.findByRole('button', { name: 'Guardar y continuar' }));

    expect(vehiclesService.update).not.toHaveBeenCalled();
    // El aviso se quita y queda a la vista el campo marcado
    await waitFor(() => expect(screen.queryByText('Cambios sin guardar')).not.toBeInTheDocument());
    expect(await screen.findByText('Nombre requerido')).toBeInTheDocument();
    // Y sigue en el resumen, editando
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
  });
});

// Las asignaciones no traen trabajo_id: con `key={t.trabajo_id ?? 'sin_trabajo'}`
// todas compartían clave y React avisaba de hijos duplicados (y podía pintar
// una tarjeta por otra al reordenar).
describe('VehicleHistory · clave de cada grupo de fotos', () => {
  const grupo = (extra) => ({
    referencia: null, nombre: null, estado: 'finalizada',
    fecha_inicio: '2026-09-18T05:00:00.000Z', fecha_fin: '2026-09-18T18:00:00.000Z',
    km_inicio: null, km_fin: null, fotos: [], ...extra,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vehiclesService.getHistory.mockResolvedValue({
      vehicle: VEHICULO,
      trabajos: [
        grupo({ tipo: 'asignacion', asignacion_id: 4, trabajo_id: null }),
        grupo({ tipo: 'asignacion', asignacion_id: 5, trabajo_id: null }),
        // mismo número que una asignación: no debe chocar con ella
        grupo({ tipo: 'trabajo', asignacion_id: null, trabajo_id: 4 }),
      ],
    });
    vehiclesService.get.mockResolvedValue(VEHICULO);
    vehiclesService.listIncidencias.mockResolvedValue([]);
    vehiclesService.listRevisiones.mockResolvedValue([]);
    usersService.list.mockResolvedValue({ data: [] });
  });

  it('pinta todas las asignaciones sin trabajo y sin claves repetidas', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const user = userEvent.setup();
      montar();
      await screen.findByRole('heading', { name: 'Ambulancia 3' });
      await user.click(screen.getByRole('button', { name: 'Fotos' }));

      expect(await screen.findByText('Asignación #4')).toBeInTheDocument();
      expect(screen.getByText('Asignación #5')).toBeInTheDocument();
      expect(screen.getByText('Trabajo #4')).toBeInTheDocument();
      const avisosDeClave = error.mock.calls.filter(args =>
        String(args[0]).includes('same key'));
      expect(avisosDeClave).toEqual([]);
    } finally {
      error.mockRestore();
    }
  });
});

// Facturas de mantenimiento: en la pestaña Revisiones, solo para administración
// (la sección Facturas está oculta al resto, MAPA_CODIGO.md §2.8).
describe('VehicleHistory · facturas de mantenimiento', () => {
  const REVISION = {
    id: 9, tipo: 'mantenimiento', fecha_revision: '2026-09-12', resultado: 'realizado',
    realizado_por: 'Taller Pepe', creado_por_nombre: 'Admin', created_at: '2026-09-12T10:00:00Z',
  };
  const FACTURA = {
    id: 31, proveedor: 'Taller Pepe', numero: 'TP-77', fecha_emision: '2026-09-12', importe: 120,
    nombre_fichero: 'tp77.pdf', tamano: 5000, vehicle_id: 7, revision_id: 9,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vehiclesService.getHistory.mockResolvedValue({ vehicle: VEHICULO, trabajos: [] });
    vehiclesService.get.mockResolvedValue(VEHICULO);
    vehiclesService.listIncidencias.mockResolvedValue([]);
    vehiclesService.listRevisiones.mockResolvedValue([REVISION]);
    usersService.list.mockResolvedValue({ data: [] });
    facturasService.list.mockResolvedValue([FACTURA]);
  });

  it('un administrador ve la factura dentro de su revisión y la descarga', async () => {
    sesionConPermiso();
    const user = userEvent.setup();
    montar(['/vehiculos/7?tab=revisiones']);

    expect(await screen.findByText('TP-77')).toBeInTheDocument();
    expect(facturasService.list).toHaveBeenCalledWith('7');
    expect(facturasService.list).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Subir factura' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();


    facturasService.descargar.mockResolvedValue();
    await user.click(screen.getByRole('button', { name: 'Descargar' }));
    expect(facturasService.descargar).toHaveBeenCalledWith(FACTURA, 'Factura_Taller_Pepe_TP-77.pdf');
  });

  it('quien no es administración no ve ni pide facturas', async () => {
    localStorage.setItem(PREFIJO + 'accessToken', 'tok');
    localStorage.setItem(PREFIJO + 'user', JSON.stringify({
      id: 2, username: 'gestor', roles: ['gestor'], permissions: ['manage_vehicles'],
    }));
    montar(['/vehiculos/7?tab=revisiones']);

    expect(await screen.findByText('Taller Pepe', { exact: false })).toBeInTheDocument();
    expect(facturasService.list).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Subir factura' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Subir factura de esta revisión/)).not.toBeInTheDocument();
    // Borrar revisiones es solo de administración: al gestor le daba un 403
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
  });

  it('sube la factura de una revisión: va con el vehículo y la revisión, y recarga la lista', async () => {
    sesionConPermiso();
    facturasService.list.mockResolvedValue([]);
    facturasService.leer.mockResolvedValue({
      con_texto: true, duplicada: false,
      datos: { proveedor: 'Taller Pepe', numero: 'TP-78', fecha_emision: '2026-09-12', importe: 80 },
    });
    facturasService.subir.mockResolvedValue({ id: 32 });
    const user = userEvent.setup();
    montar(['/vehiculos/7?tab=revisiones']);

    await user.click(await screen.findByRole('button', { name: '+ Subir factura de esta revisión' }));
    // El popup se carga con lazy(): llega un instante después
    expect(await screen.findByText(/Factura de mantenimiento de/)).toBeInTheDocument();
    await user.upload(screen.getByLabelText(/PDF de la factura/), new File(['%PDF-'], 'tp78.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));

    const revision = await screen.findByLabelText('Revisión que factura');
    expect(revision).toHaveValue('9');
    await user.click(screen.getByRole('button', { name: 'Guardar factura' }));

    await waitFor(() => expect(facturasService.subir).toHaveBeenCalledTimes(1));
    expect(facturasService.subir.mock.calls[0][0]).toMatchObject({
      proveedor: 'Taller Pepe', numero: 'TP-78', vehicle_id: 7, revision_id: '9',
    });
    await waitFor(() => expect(facturasService.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Factura de mantenimiento de/)).not.toBeInTheDocument();
  });
});

// Mantenimiento cada 15.000 km (v37)
describe('VehicleHistory · mantenimiento por km', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sesionConPermiso();
    const conMant = { ...VEHICULO, km_proximo_mantenimiento: 121000 };
    vehiclesService.getHistory.mockResolvedValue({ vehicle: conMant, trabajos: [] });
    vehiclesService.get.mockResolvedValue(conMant);
    vehiclesService.update.mockResolvedValue(conMant);
    vehiclesService.listIncidencias.mockResolvedValue([]);
    vehiclesService.listRevisiones.mockResolvedValue([]);
    vehiclesService.createRevision.mockResolvedValue({ id: 50 });
    usersService.list.mockResolvedValue({ data: [] });
  });

  it('el resumen dice a cuántos km toca y cuántos quedan', async () => {
    montar();
    expect(await screen.findByText('Próximo mantenimiento')).toBeInTheDocument();
    expect(screen.getByText('(quedan 1.000 km)')).toBeInTheDocument();
  });

  it('se puede cambiar a mano desde el resumen, y en blanco viaja como null', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByRole('heading', { name: 'Ambulancia 3' });
    await user.click(await screen.findByRole('button', { name: 'Editar' }));

    const campo = screen.getByDisplayValue('121000');
    await user.clear(campo);
    await user.type(campo, '125.000');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(vehiclesService.update).toHaveBeenCalledTimes(1));
    expect(vehiclesService.update.mock.calls[0][1].km_proximo_mantenimiento).toBe(125000);

    await user.click(await screen.findByRole('button', { name: 'Editar' }));
    await user.clear(screen.getByDisplayValue('121000'));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(vehiclesService.update).toHaveBeenCalledTimes(2));
    expect(vehiclesService.update.mock.calls[1][1].km_proximo_mantenimiento).toBeNull();
  });

  // El ejemplo del usuario: el taller dice que no hay nada que hacer y que
  // vuelva en 5.000 km
  it('una revisión de mantenimiento cita el siguiente a lo que diga el taller y recarga el vehículo', async () => {
    const user = userEvent.setup();
    const { container } = montar(['/vehiculos/7?tab=revisiones']);
    await user.click(await screen.findByRole('button', { name: '+ Nueva revisión' }));

    // Los km del vehículo vienen ya puestos, y por defecto el siguiente a +15.000
    expect(screen.getByPlaceholderText('Ej: 15.300')).toHaveValue('120000');
    expect(screen.getByText('Le tocará a los 135.000 km. Si el taller cita antes, cámbialo.')).toBeInTheDocument();

    const dentro = screen.getByPlaceholderText('15000');
    await user.clear(dentro);
    await user.type(dentro, '5000');
    expect(screen.getByText('Le tocará a los 125.000 km. Si el taller cita antes, cámbialo.')).toBeInTheDocument();

    await user.type(container.querySelector('input[type="date"]'), '2026-10-12');
    const llamadasAntes = vehiclesService.get.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(vehiclesService.createRevision).toHaveBeenCalledTimes(1));
    expect(vehiclesService.createRevision.mock.calls[0][1]).toMatchObject({
      tipo: 'mantenimiento', km: 120000, km_proximo: 125000,
    });
    await waitFor(() => expect(vehiclesService.get.mock.calls.length).toBeGreaterThan(llamadasAntes));
  });

  it('«dentro de» a medida sin los km de la revisión no se guarda: no tendría desde dónde contar', async () => {
    const user = userEvent.setup();
    const { container } = montar(['/vehiculos/7?tab=revisiones']);
    await user.click(await screen.findByRole('button', { name: '+ Nueva revisión' }));

    await user.clear(screen.getByPlaceholderText('Ej: 15.300'));
    const dentro = screen.getByPlaceholderText('15000');
    await user.clear(dentro);
    await user.type(dentro, '5000');
    await user.type(container.querySelector('input[type="date"]'), '2026-10-12');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(vehiclesService.createRevision).not.toHaveBeenCalled();

    // Con los km puestos, sí, y cuenta desde ellos
    await user.type(screen.getByPlaceholderText('Ej: 15.300'), '15300');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(vehiclesService.createRevision).toHaveBeenCalledTimes(1));
    expect(vehiclesService.createRevision.mock.calls[0][1]).toMatchObject({ km: 15300, km_proximo: 20300 });

  });

  it('en una ITV no se piden km', async () => {

    const user = userEvent.setup();
    montar(['/vehiculos/7?tab=revisiones']);
    await user.click(await screen.findByRole('button', { name: '+ Nueva revisión' }));
    await user.selectOptions(screen.getByDisplayValue('Mantenimiento'), 'itv');

    expect(screen.queryByPlaceholderText('Ej: 15.300')).not.toBeInTheDocument();
  });
});
