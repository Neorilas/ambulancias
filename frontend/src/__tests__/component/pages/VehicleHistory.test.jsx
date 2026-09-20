import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../../services/vehicles.service.js', () => ({
  vehiclesService: {
    getHistory:      vi.fn(),
    get:             vi.fn(),
    update:          vi.fn(),
    listIncidencias: vi.fn(),
    listRevisiones:  vi.fn(),
  },
}));
vi.mock('../../../services/users.service.js', () => ({
  usersService: { list: vi.fn() },
}));
vi.mock('../../../services/auth.service.js', () => ({
  authService: { login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));

import { vehiclesService } from '../../../services/vehicles.service.js';
import { usersService }    from '../../../services/users.service.js';
import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import { AuthProvider }         from '../../../context/AuthContext.jsx';
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

function montar() {
  return render(
    <NotificationProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={['/vehiculos/7']}>
          <Routes>
            <Route path="/vehiculos/:id" element={<VehicleHistory />} />
          </Routes>
        </MemoryRouter>
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
