import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/trabajos.service.js', () => ({
  trabajosService: { create: vi.fn(), update: vi.fn() },
}));
vi.mock('../../../services/vehicles.service.js', () => ({
  vehiclesService: { list: vi.fn().mockResolvedValue({ data: [] }) },
}));
vi.mock('../../../services/users.service.js', () => ({
  usersService: { list: vi.fn().mockResolvedValue({ data: [] }) },
}));

import { NotificationProvider } from '../../../context/NotificationContext.jsx';
import TrabajoForm from '../../../pages/trabajos/TrabajoForm.jsx';

const montar = (trabajo) => render(
  <NotificationProvider>
    <TrabajoForm trabajo={trabajo} onSaved={vi.fn()} onClose={vi.fn()} />
  </NotificationProvider>
);

describe('TrabajoForm · ubicación en Google Maps (v34)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('con texto y sin enlace avisa de que la búsqueda puede no ser precisa y deja comprobarla', async () => {
    const user = userEvent.setup();
    montar();
    expect(screen.queryByTestId('aviso-ubicacion-imprecisa')).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Nombre del sitio o dirección'), 'Retiro');
    const aviso = screen.getByTestId('aviso-ubicacion-imprecisa');
    expect(aviso).toHaveTextContent('puede no llevar al sitio exacto');
    expect(screen.getByRole('link', { name: 'Comprobar en Google Maps' }))
      .toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=Retiro');
  });

  it('con el enlace de Maps pegado, el aviso desaparece', async () => {
    const user = userEvent.setup();
    montar();
    await user.type(screen.getByPlaceholderText('Nombre del sitio o dirección'), 'Retiro');
    await user.type(screen.getByPlaceholderText('https://maps.app.goo.gl/…'), 'https://maps.app.goo.gl/abc');
    expect(screen.queryByTestId('aviso-ubicacion-imprecisa')).not.toBeInTheDocument();
  });

  it('al editar, carga el enlace guardado', () => {
    montar({ nombre: 'M', ubicacion: 'Retiro', ubicacion_url: 'https://maps.app.goo.gl/abc', usuarios: [] });
    expect(screen.getByPlaceholderText('https://maps.app.goo.gl/…')).toHaveValue('https://maps.app.goo.gl/abc');
    expect(screen.queryByTestId('aviso-ubicacion-imprecisa')).not.toBeInTheDocument();
  });

  it('un enlace que no es de Google Maps no deja guardar', async () => {
    const user = userEvent.setup();
    montar();
    await user.type(screen.getByPlaceholderText('https://maps.app.goo.gl/…'), 'https://ejemplo.com');
    await user.click(screen.getByRole('button', { name: 'Crear trabajo' }));
    expect(screen.getByText('Tiene que ser un enlace de Google Maps (el de «Compartir»)')).toBeInTheDocument();
    const { trabajosService } = await import('../../../services/trabajos.service.js');
    expect(trabajosService.create).not.toHaveBeenCalled();
  });
});

// 2026-10-16, TRB-2026-0040: una ambulancia con el inicio ya pasado la activa
// el cron al minuto de guardarla
describe('TrabajoForm · aviso de hora de inicio pasada', () => {
  beforeEach(() => vi.clearAllMocks());

  it('avisa en la ambulancia, con su hora o con la del trabajo si la deja en blanco', async () => {
    const user = userEvent.setup();
    const { container } = montar();
    await user.click(screen.getByRole('button', { name: '+ Añadir ambulancia' }));
    expect(screen.queryByTestId('aviso-inicio-pasado')).not.toBeInTheDocument();

    const [inicioTrabajo, , inicioAmb] = container.querySelectorAll('input[type="datetime-local"]');
    // En blanco toma la del trabajo
    fireEvent.change(inicioTrabajo, { target: { value: '2020-01-01T10:00' } });
    expect(screen.getByTestId('aviso-inicio-pasado')).toHaveTextContent('se activará sola en un minuto');

    fireEvent.change(inicioAmb, { target: { value: '2099-01-01T10:00' } });
    expect(screen.queryByTestId('aviso-inicio-pasado')).not.toBeInTheDocument();

    fireEvent.change(inicioTrabajo, { target: { value: '2099-01-01T09:00' } });
    fireEvent.change(inicioAmb, { target: { value: '2020-01-01T10:00' } });
    expect(screen.getByTestId('aviso-inicio-pasado')).toBeInTheDocument();
  });
});

describe('TrabajoForm · varios coordinadores (v35)', () => {
  const USERS = [
    { id: 50, nombre: 'Carla', apellidos: 'Ruiz', username: 'carla', activo: 1 },
    { id: 51, nombre: 'Pablo', apellidos: 'Gil',  username: 'pablo', activo: 1 },
  ];
  const TRABAJO = {
    id: 7, nombre: 'Maratón', fecha_inicio: '2026-10-15T08:00:00Z', fecha_fin: '2026-10-15T20:00:00Z',
    usuarios: [], coordinador_user_id: 50, coordinadores: [{ id: 50, nombre: 'Carla', apellidos: 'Ruiz' }],
  };

  beforeEach(() => vi.clearAllMocks());

  it('al editar carga los que hay, deja añadir otro y manda la lista entera', async () => {
    const { usersService } = await import('../../../services/users.service.js');
    const { trabajosService } = await import('../../../services/trabajos.service.js');
    usersService.list.mockResolvedValueOnce({ data: USERS });
    const user = userEvent.setup();
    montar(TRABAJO);

    expect(await screen.findByDisplayValue('Carla Ruiz')).toBeInTheDocument();
    // Con uno solo no se puede quitar: el trabajo siempre tiene quien lo cierre
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+ Añadir otro coordinador' }));
    const [, nuevo] = screen.getAllByPlaceholderText('Buscar por nombre o usuario…');
    await user.click(nuevo);
    // Quien ya coordina no se ofrece otra vez
    expect(screen.queryByText('Carla Ruiz')).not.toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('Pablo Gil'));

    await user.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(trabajosService.update).toHaveBeenCalledWith(7, expect.objectContaining({ coordinadores: [50, 51] }));
  });

  it('en el alta, sin ningún coordinador no deja guardar', async () => {
    const { trabajosService } = await import('../../../services/trabajos.service.js');
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole('button', { name: 'Crear trabajo' }));
    expect(screen.getByText('Elige quién coordina el trabajo')).toBeInTheDocument();
    expect(trabajosService.create).not.toHaveBeenCalled();
  });
});

// Previsto (v41): entra a semanas vista, sin ambulancias ni coordinador
describe('TrabajoForm · previsto (v41)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marcado «Trabajo previsto», se crea sin coordinador y lo dice al backend', async () => {
    const { trabajosService } = await import('../../../services/trabajos.service.js');
    trabajosService.create.mockResolvedValueOnce({ id: 9 });
    const user = userEvent.setup();
    const { container } = montar();

    await user.type(screen.getByPlaceholderText('Ej.: Cobertura maratón de Madrid'), 'Feria de abril');
    const [ini, fin] = container.querySelectorAll('input[type="datetime-local"]');
    fireEvent.change(ini, { target: { value: '2026-12-01T08:00' } });
    fireEvent.change(fin, { target: { value: '2026-12-01T20:00' } });
    await user.click(screen.getByRole('checkbox', { name: /Trabajo previsto/ }));
    expect(screen.getByText('(cuando se sepa)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Crear trabajo' }));

    expect(screen.queryByText('Elige quién coordina el trabajo')).not.toBeInTheDocument();
    const enviado = trabajosService.create.mock.calls[0][0];
    expect(enviado.previsto).toBe(true);
    expect(enviado).not.toHaveProperty('coordinadores');
  });

  it('al editar uno previsto, recuerda qué le falta y no exige coordinador', async () => {
    const { trabajosService } = await import('../../../services/trabajos.service.js');
    trabajosService.update.mockResolvedValueOnce({ id: 8 });
    const user = userEvent.setup();
    montar({ id: 8, nombre: 'Feria', estado: 'previsto', fecha_inicio: '2026-12-01T08:00:00Z',
      fecha_fin: '2026-12-01T20:00:00Z', usuarios: [], coordinadores: [] });

    expect(screen.getByTestId('aviso-previsto')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Trabajo previsto/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(trabajosService.update).toHaveBeenCalledWith(8, expect.not.objectContaining({ coordinadores: [] }));
  });
});

// 2026-10-19: CONGRESO SEVILLA y CHINCHILLA se alargaron un día y el día
// nuevo no llegaba a sus ambulancias, que seguían con su fin
describe('TrabajoForm · alargar el trabajo', () => {
  const TRABAJO = {
    id: 34, nombre: 'Congreso', estado: 'activo', usuarios: [],
    fecha_inicio: '2026-10-20T06:00:00Z', fecha_fin: '2026-10-22T20:00:00Z',
    coordinador_user_id: 50, coordinadores: [{ id: 50, nombre: 'Carla', apellidos: 'Ruiz' }],
    asignaciones: [
      { id: 167, estado: 'activa', vehiculo_alias: 'UVI-1', fecha_fin: '2026-10-22T20:00:00Z' },
      { id: 168, estado: 'programada', vehiculo_alias: 'SVB-2', fecha_fin: '2026-10-21T20:00:00Z' },
      { id: 169, estado: 'finalizada', vehiculo_alias: 'SVB-3', fecha_fin: '2026-10-22T20:00:00Z' },
    ],
  };
  const finInput = (container) => container.querySelectorAll('input[type="datetime-local"]')[1];

  beforeEach(() => vi.clearAllMocks());

  it('sin cambiar el fin no ofrece nada', () => {
    montar(TRABAJO);
    expect(screen.queryByTestId('mover-fin-ambulancias')).not.toBeInTheDocument();
  });

  it('al alargarlo ofrece mover las abiertas que acababan con él, marcado, y lo manda', async () => {
    const { trabajosService } = await import('../../../services/trabajos.service.js');
    trabajosService.update.mockResolvedValueOnce({ id: 34, ambulancias_alargadas: 1 });
    const user = userEvent.setup();
    const { container } = montar(TRABAJO);

    fireEvent.change(finInput(container), { target: { value: '2026-10-23T22:00' } });
    const casilla = screen.getByTestId('mover-fin-ambulancias');
    expect(casilla).toHaveTextContent('Cambiar también el fin de su ambulancia');
    expect(casilla).toHaveTextContent('UVI-1 acababa con el trabajo');
    expect(casilla).not.toHaveTextContent('SVB-2');
    expect(screen.getByRole('checkbox', { name: /Cambiar también el fin/ })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(trabajosService.update).toHaveBeenCalledWith(34, expect.objectContaining({ mover_fin_ambulancias: true }));
  });

  it('desmarcada, no se mueve ninguna', async () => {
    const { trabajosService } = await import('../../../services/trabajos.service.js');
    trabajosService.update.mockResolvedValueOnce({ id: 34 });
    const user = userEvent.setup();
    const { container } = montar(TRABAJO);

    fireEvent.change(finInput(container), { target: { value: '2026-10-23T22:00' } });
    await user.click(screen.getByRole('checkbox', { name: /Cambiar también el fin/ }));
    await user.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(trabajosService.update.mock.calls[0][1]).not.toHaveProperty('mover_fin_ambulancias');
  });
});
