import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../services/inventario.service.js', () => ({
  inventarioService: { ambulancias: vi.fn(), deAmbulancia: vi.fn(), anadir: vi.fn(), guardar: vi.fn(), quitar: vi.fn() },
}));
vi.mock('../../../services/asignaciones.service.js', () => ({
  asignacionesService: { catalogoMaterial: vi.fn() },
}));

import { inventarioService } from '../../../services/inventario.service.js';
import { asignacionesService } from '../../../services/asignaciones.service.js';
import { NotificationProvider, useNotification } from '../../../context/NotificationContext.jsx';
import InventarioAmbulancia from '../../../components/inventario/InventarioAmbulancia.jsx';

const LINEAS = [
  { id: 1, producto_id: 5, nombre: 'Guedel 3', presentacion: 'Unidad', caducidad: '2099-10-31', cantidad: 4, notas: null, del_almacen: true },
  { id: 2, producto_id: 6, nombre: 'Adrenalina', presentacion: 'Ampolla', caducidad: '2020-01-01', cantidad: 2, notas: 'Nevera', del_almacen: true },
  { id: 3, producto_id: null, nombre: 'Manta térmica', presentacion: null, caducidad: null, cantidad: 0, notas: null, del_almacen: false },
];
const CATALOGO = [
  { id: 5, nombre: 'Guedel 3', presentacion: 'Unidad' },
  { id: 8, nombre: 'Guantes M', presentacion: 'Caja' },
  { id: 9, nombre: 'Guantes L', presentacion: 'Caja' },
];

function Avisos() {
  const { toasts } = useNotification();
  return toasts.map(t => <p key={t.id}>{t.message}</p>);
}

function montar(props = {}) {
  return render(
    <NotificationProvider>
      <InventarioAmbulancia vehicleId="7" puedeEditar {...props} />
      <Avisos />
    </NotificationProvider>
  );
}

describe('InventarioAmbulancia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inventarioService.deAmbulancia.mockResolvedValue({ vehiculo: { id: 7, alias: 'UVI-03' }, lineas: LINEAS });
    asignacionesService.catalogoMaterial.mockResolvedValue(CATALOGO);
  });

  it('lista lo que lleva, con caducidad, avisos y lo que no es del almacén', async () => {
    montar();
    expect(await screen.findByText('Guedel 3')).toBeInTheDocument();
    expect(inventarioService.deAmbulancia).toHaveBeenCalledWith('7');
    expect(screen.getByText(/3 elementos/)).toBeInTheDocument();
    expect(screen.getByText('· 1 caducado')).toBeInTheDocument();
    expect(screen.getByText('· 1 a 0')).toBeInTheDocument();
    expect(screen.getByText(/caducado hace/)).toBeInTheDocument();
    expect(screen.getByText('· No es del almacén')).toBeInTheDocument();
    expect(screen.getByText('Nevera')).toBeInTheDocument();
    expect(screen.getByLabelText('Cantidad 0')).toHaveClass('text-bad-600');
  });

  it('el buscador filtra sin tildes', async () => {
    const user = userEvent.setup();
    montar();
    await screen.findByText('Guedel 3');
    await user.type(screen.getByLabelText('Buscar en el inventario'), 'termica');
    expect(screen.getByText('Manta térmica')).toBeInTheDocument();
    expect(screen.queryByText('Guedel 3')).not.toBeInTheDocument();
  });

  it('quien solo mira (gestor) no ve «Añadir» ni «Editar» y no pide el catálogo', async () => {
    montar({ puedeEditar: false });
    await screen.findByText('Guedel 3');
    expect(screen.queryByRole('button', { name: 'Añadir' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Editar/ })).not.toBeInTheDocument();
    expect(asignacionesService.catalogoMaterial).not.toHaveBeenCalled();
  });

  it('vacío lo dice, distinto para quien puede añadir', async () => {
    inventarioService.deAmbulancia.mockResolvedValue({ vehiculo: { id: 7 }, lineas: [] });
    const { unmount } = montar();
    expect(await screen.findByText('El inventario está vacío')).toBeInTheDocument();
    expect(screen.getByText(/aparecerá aquí solo/)).toBeInTheDocument();
    unmount();
    montar({ puedeEditar: false });
    expect(await screen.findByText(/Aún no se ha apuntado/)).toBeInTheDocument();
  });

  it('si no carga lo dice con «Reintentar», no como vacío', async () => {
    inventarioService.deAmbulancia.mockRejectedValueOnce(new Error('No se pudo cargar el inventario'));
    const user = userEvent.setup();
    montar();
    expect(await screen.findByText('No se pudo cargar el inventario')).toBeInTheDocument();
    expect(screen.queryByText('El inventario está vacío')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Guedel 3')).toBeInTheDocument();
  });

  describe('añadir', () => {
    it('el nombre se autocompleta con el almacén y va como producto', async () => {
      inventarioService.anadir.mockResolvedValue({ data: {}, message: 'Añadido al inventario' });
      const user = userEvent.setup();
      montar();
      await screen.findByText('Guedel 3');
      await user.click(screen.getByRole('button', { name: 'Añadir' }));
      await user.type(screen.getByLabelText(/Qué es/), 'guan');
      const sugerencias = await screen.findByRole('list', { name: 'Productos del almacén' });
      expect(within(sugerencias).getAllByRole('button')).toHaveLength(2);
      await user.click(within(sugerencias).getByRole('button', { name: /Guantes M/ }));
      expect(screen.getByText('Guantes M')).toBeInTheDocument();
      await user.type(screen.getByRole('textbox', { name: /Cantidad/ }), '3');
      await user.type(screen.getByLabelText('Caducidad'), '2030-05-31');
      await user.click(screen.getAllByRole('button', { name: 'Añadir' }).at(-1));
      await waitFor(() => expect(inventarioService.anadir).toHaveBeenCalledWith('7', {
        producto_id: 8, cantidad: 3, caducidad: '2030-05-31', notas: null,
      }));
      expect(await screen.findByText('Añadido al inventario')).toBeInTheDocument();
      expect(inventarioService.deAmbulancia).toHaveBeenCalledTimes(2);
    });

    it('lo que no está en el almacén va como texto libre', async () => {
      inventarioService.anadir.mockResolvedValue({ data: {}, message: 'Añadido al inventario' });
      const user = userEvent.setup();
      montar();
      await screen.findByText('Guedel 3');
      await user.click(screen.getByRole('button', { name: 'Añadir' }));
      await user.type(screen.getByLabelText(/Qué es/), 'Linterna frontal');
      expect(await screen.findByText(/se apunta como texto libre/)).toBeInTheDocument();
      await user.type(screen.getByRole('textbox', { name: /Cantidad/ }), '1');
      await user.type(screen.getByLabelText('Notas'), 'cajón 2');
      await user.click(screen.getAllByRole('button', { name: 'Añadir' }).at(-1));
      await waitFor(() => expect(inventarioService.anadir).toHaveBeenCalledWith('7', {
        nombre: 'Linterna frontal', cantidad: 1, caducidad: null, notas: 'cajón 2',
      }));
    });

    it('escribir el nombre exacto de un producto sin pinchar la sugerencia es ese producto', async () => {
      inventarioService.anadir.mockResolvedValue({ data: {}, message: 'Sumado: ahora hay 6' });
      const user = userEvent.setup();
      montar();
      await screen.findByText('Guedel 3');
      await user.click(screen.getByRole('button', { name: 'Añadir' }));
      await user.type(screen.getByLabelText(/Qué es/), 'guedel 3');
      await user.type(screen.getByRole('textbox', { name: /Cantidad/ }), '2');
      await user.click(screen.getAllByRole('button', { name: 'Añadir' }).at(-1));
      await waitFor(() => expect(inventarioService.anadir).toHaveBeenCalledWith('7', expect.objectContaining({ producto_id: 5 })));
      expect(await screen.findByText('Sumado: ahora hay 6')).toBeInTheDocument();
    });

    it('sin nombre o sin cantidad no se manda; el error del servidor sale en el popup', async () => {
      inventarioService.anadir.mockRejectedValue(new Error('Ese producto está retirado del catálogo del almacén'));
      const user = userEvent.setup();
      montar();
      await screen.findByText('Guedel 3');
      await user.click(screen.getByRole('button', { name: 'Añadir' }));
      const enviar = () => user.click(screen.getAllByRole('button', { name: 'Añadir' }).at(-1));
      await enviar();
      expect(screen.getByRole('alert')).toHaveTextContent('Di qué es');
      await user.type(screen.getByLabelText(/Qué es/), 'Guedel 3');
      await enviar();
      expect(screen.getByRole('alert')).toHaveTextContent('La cantidad');
      await user.type(screen.getByRole('textbox', { name: /Cantidad/ }), '1');
      await enviar();
      expect(await screen.findByRole('alert')).toHaveTextContent('retirado del catálogo');
    });

    it('sin catálogo (sin red) se puede escribir a mano', async () => {
      asignacionesService.catalogoMaterial.mockRejectedValue(new Error('red'));
      const user = userEvent.setup();
      montar();
      await screen.findByText('Guedel 3');
      await user.click(screen.getByRole('button', { name: 'Añadir' }));
      expect(await screen.findByText(/No se pudo cargar el catálogo/)).toBeInTheDocument();
    });
  });

  describe('editar y quitar', () => {
    it('guarda la cantidad a 0 (se acabó) con su caducidad y notas', async () => {
      inventarioService.guardar.mockResolvedValue({});
      const user = userEvent.setup();
      montar();
      await screen.findByText('Guedel 3');
      await user.click(screen.getByRole('button', { name: 'Editar Adrenalina' }));
      const cantidad = screen.getByRole('textbox', { name: /Cantidad/ });
      expect(cantidad).toHaveValue('2');
      await user.clear(cantidad);
      await user.type(cantidad, '0');
      await user.click(screen.getByRole('button', { name: 'Guardar' }));
      await waitFor(() => expect(inventarioService.guardar).toHaveBeenCalledWith(2, {
        cantidad: 0, caducidad: '2020-01-01', notas: 'Nevera',
      }));
      expect(await screen.findByText('Guardado')).toBeInTheDocument();
    });

    it('quitar pide confirmación y luego quita', async () => {
      inventarioService.quitar.mockResolvedValue({});
      const user = userEvent.setup();
      montar();
      await screen.findByText('Guedel 3');
      await user.click(screen.getByRole('button', { name: 'Editar Manta térmica' }));
      await user.click(screen.getByRole('button', { name: 'Quitar del inventario' }));
      expect(screen.getByText(/Se quita «Manta térmica» \(0\)/)).toBeInTheDocument();
      expect(inventarioService.quitar).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Quitar' }));
      await waitFor(() => expect(inventarioService.quitar).toHaveBeenCalledWith(3));
      expect(await screen.findByText('Quitado del inventario')).toBeInTheDocument();
    });
  });
});
