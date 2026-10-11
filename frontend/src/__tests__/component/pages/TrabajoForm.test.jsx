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
