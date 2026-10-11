import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
