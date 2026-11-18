import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../services/almacen.service.js', () => ({
  almacenService: {
    productos: vi.fn(), producto: vi.fn(), crearProducto: vi.fn(), guardarProducto: vi.fn(),
    movimiento: vi.fn(), recuento: vi.fn(), corregirCaducidad: vi.fn(), movimientos: vi.fn(),
  },
}));
vi.mock('../../../services/vehicles.service.js', () => ({
  vehiclesService: { list: vi.fn() },
}));

import { almacenService } from '../../../services/almacen.service.js';
import { vehiclesService } from '../../../services/vehicles.service.js';
import { NotificationProvider, useNotification } from '../../../context/NotificationContext.jsx';
import Almacen from '../../../pages/almacen/Almacen.jsx';

const PRODUCTOS = [
  { id: 1, nombre: 'Guedel 3', presentacion: 'Unidad', tipo: 'producto', stock: 12, stock_minimo: 20, activo: true,
    proxima_caducidad: '2030-10-31', lotes_con_stock: 2, lotes_negativos: 0 },
  { id: 2, nombre: 'Adiro', presentacion: 'Pastillas', tipo: 'medicacion', stock: 5, stock_minimo: 0, activo: true,
    proxima_caducidad: '2020-01-01', lotes_con_stock: 1, lotes_negativos: 1 },
  { id: 3, nombre: 'Viejo', presentacion: 'Caja', tipo: 'producto', stock: 0, stock_minimo: 0, activo: false,
    proxima_caducidad: null, lotes_con_stock: 0, lotes_negativos: 0 },
];
const FICHA = {
  ...PRODUCTOS[0],
  lotes: [
    { id: 10, caducidad: '2030-10-31', stock: 8 },
    { id: 11, caducidad: null, stock: 4 },
    { id: 12, caducidad: '2025-01-01', stock: 0 },
  ],
};

function Avisos() {
  const { toasts } = useNotification();
  return toasts.map(t => <p key={t.id}>{t.message}</p>);
}

function montar(url = '/almacen') {
  return render(
    <NotificationProvider>
      <MemoryRouter initialEntries={[url]}><Almacen /></MemoryRouter>
      <Avisos />
    </NotificationProvider>
  );
}

describe('Almacén', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    almacenService.productos.mockResolvedValue(PRODUCTOS);
    almacenService.producto.mockResolvedValue(FICHA);
    almacenService.movimientos.mockResolvedValue({ data: [], pagination: { total: 0, page: 1, totalPages: 0 } });
    vehiclesService.list.mockResolvedValue({ data: [{ id: 7, alias: 'UVI-03', matricula: '1234ABC' }] });
  });

  it('lista el stock, marca el bajo mínimo y esconde los retirados', async () => {
    montar();
    expect(await screen.findByText('Guedel 3')).toBeInTheDocument();
    expect(screen.getByText('Adiro')).toBeInTheDocument();
    expect(screen.queryByText('Viejo')).not.toBeInTheDocument();
    expect(screen.getByText('12')).toHaveClass('text-bad-600');
    expect(screen.getByText(/caducado hace/)).toBeInTheDocument();
    expect(screen.getByText('2 productos')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Ver retirados'));
    expect(await screen.findByText('Viejo')).toBeInTheDocument();
  });

  it('filtra por aviso con su contador', async () => {
    montar();
    await screen.findByText('Guedel 3');
    fireEvent.click(screen.getByRole('button', { name: 'Bajo mínimo · 1' }));
    await waitFor(() => expect(screen.queryByText('Adiro')).not.toBeInTheDocument());
    expect(screen.getByText('Guedel 3')).toBeInTheDocument();
  });

  it('busca sin tildes', async () => {
    montar('/almacen?q=adíro');
    expect(await screen.findByText('Adiro')).toBeInTheDocument();
    expect(screen.queryByText('Guedel 3')).not.toBeInTheDocument();
  });

  it('si no carga lo dice y deja reintentar', async () => {
    almacenService.productos.mockRejectedValueOnce(new Error('No se pudo cargar el almacén'));
    montar();
    expect(await screen.findByText('No se pudo cargar el almacén')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Guedel 3')).toBeInTheDocument();
  });

  it('apunta una entrada y pone el stock nuevo en la lista', async () => {
    almacenService.movimiento.mockResolvedValue({ id: 90, lote_id: 10, producto: { ...PRODUCTOS[0], stock: 22 } });
    montar();
    await screen.findByText('Guedel 3');
    fireEvent.click(screen.getAllByRole('button', { name: 'Entrada' })[0]);
    const dialogo = await screen.findByText('Entrada al almacén');
    const modal = dialogo.closest('div.relative');

    fireEvent.click(within(modal).getByRole('button', { name: 'Apuntar entrada' }));
    expect(await within(modal).findByRole('alert')).toHaveTextContent('Pon cuántas unidades entran');

    fireEvent.change(within(modal).getByLabelText(/Cantidad/), { target: { value: '10' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Apuntar entrada' }));
    expect(await within(modal).findByRole('alert')).toHaveTextContent('Pon la caducidad');

    fireEvent.change(within(modal).getByLabelText(/^Caducidad/), { target: { value: '2031-05-31' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Apuntar entrada' }));
    await waitFor(() => expect(almacenService.movimiento).toHaveBeenCalledWith({
      tipo: 'entrada', producto_id: 1, caducidad: '2031-05-31', cantidad: 10, notas: '',
    }));
    expect(await screen.findByText('Entrada apuntada')).toBeInTheDocument();
    expect(screen.getByText('22')).toBeInTheDocument();
  });

  it('apunta una salida a una ambulancia desde el lote que caduca antes', async () => {
    almacenService.movimiento.mockResolvedValue({ id: 91, lote_id: 10, producto: { ...PRODUCTOS[0], stock: 9 } });
    montar();
    await screen.findByText('Guedel 3');
    fireEvent.click(screen.getAllByRole('button', { name: 'Salida' })[0]);
    const modal = (await screen.findByText('Salida del almacén')).closest('div.relative');
    expect(within(modal).getByLabelText('Lote')).toHaveValue('10');

    fireEvent.change(within(modal).getByLabelText(/^Cantidad/), { target: { value: '9' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Apuntar salida' }));
    expect(await within(modal).findByRole('alert')).toHaveTextContent('De ese lote solo quedan 8');

    fireEvent.change(within(modal).getByLabelText(/^Cantidad/), { target: { value: '3' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Apuntar salida' }));
    expect(await within(modal).findByRole('alert')).toHaveTextContent('Elige la ambulancia');

    fireEvent.change(within(modal).getByLabelText(/^Ambulancia/), { target: { value: '7' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Apuntar salida' }));
    await waitFor(() => expect(almacenService.movimiento).toHaveBeenCalledWith({
      tipo: 'salida_ambulancia', lote_id: 10, cantidad: 3, notas: '', vehicle_id: 7,
    }));
    expect(await screen.findByText('Salida apuntada')).toBeInTheDocument();
  });

  it('una salida a otro sitio pide el destino y el error del backend se queda en el popup', async () => {
    almacenService.movimiento.mockRejectedValue(new Error('De ese lote solo quedan 1'));
    montar();
    await screen.findByText('Guedel 3');
    fireEvent.click(screen.getAllByRole('button', { name: 'Salida' })[0]);
    const modal = (await screen.findByText('Salida del almacén')).closest('div.relative');
    fireEvent.change(within(modal).getByLabelText(/^Cantidad/), { target: { value: '1' } });
    fireEvent.click(within(modal).getByLabelText('A otro sitio'));
    fireEvent.click(within(modal).getByRole('button', { name: 'Apuntar salida' }));
    expect(await within(modal).findByRole('alert')).toHaveTextContent('Di adónde va');
    fireEvent.change(within(modal).getByLabelText(/^Destino/), { target: { value: 'Botiquín' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Apuntar salida' }));
    expect(await within(modal).findByRole('alert')).toHaveTextContent('De ese lote solo quedan 1');
    expect(almacenService.movimiento).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'salida_otros', destino: 'Botiquín' }));
  });

  it('la ficha enseña los lotes con existencias y deja hacer un recuento', async () => {
    almacenService.recuento.mockResolvedValue({ lote_id: 10, stock: 6, diferencia: -2, message: 'Recuento apuntado' });
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Guedel 3' }));
    expect(await screen.findByText('Lotes')).toBeInTheDocument();
    expect(screen.getByText('No caduca')).toBeInTheDocument();
    expect(screen.queryByText('01/01/2025')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver también los vacíos (1)' }));
    expect(screen.getByText('01/01/2025')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Recuento' })[0]);
    const modal = (await screen.findByText('Recuento del lote')).closest('div.relative');
    fireEvent.change(within(modal).getByLabelText(/Contadas/), { target: { value: '6' } });
    expect(within(modal).getByText('-2')).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: 'Apuntar recuento' }));
    await waitFor(() => expect(almacenService.recuento).toHaveBeenCalledWith(10, 6, ''));
    expect(await screen.findByText('Recuento apuntado')).toBeInTheDocument();
  });

  it('da de alta un producto', async () => {
    almacenService.crearProducto.mockResolvedValue({ ...PRODUCTOS[0], id: 9, nombre: 'Gasas', stock: 0 });
    montar();
    await screen.findByText('Guedel 3');
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    const modal = (await screen.findByText('Nuevo producto', { selector: 'h2' })).closest('div.relative');
    fireEvent.click(within(modal).getByRole('button', { name: 'Añadir' }));
    expect(await within(modal).findByRole('alert')).toHaveTextContent('Pon el nombre');
    fireEvent.change(within(modal).getByLabelText(/Nombre/), { target: { value: 'Gasas' } });
    fireEvent.change(within(modal).getByLabelText('Stock mínimo'), { target: { value: '4' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Añadir' }));
    await waitFor(() => expect(almacenService.crearProducto).toHaveBeenCalledWith({
      nombre: 'Gasas', presentacion: 'Unidad', tipo: 'producto', stock_minimo: 4,
    }));
    expect(await screen.findByText('Producto añadido')).toBeInTheDocument();
    expect(screen.getByText('Gasas')).toBeInTheDocument();
  });

  it('la vista Movimientos filtra por ambulancia', async () => {
    almacenService.movimientos.mockResolvedValue({
      data: [{ id: 1, tipo: 'salida_ambulancia', cantidad: -2, fecha: '2026-06-02T10:00:00Z', producto: 'Guedel 3',
               caducidad: '2030-10-31', vehiculo_alias: 'UVI-03', usuario: 'Ana', importado: true }],
      pagination: { total: 1, page: 1, totalPages: 1, hasPrev: false, hasNext: false },
    });
    montar('/almacen?vista=movimientos');
    expect(await screen.findByText('UVI-03')).toBeInTheDocument();
    expect(screen.getByText('−2')).toBeInTheDocument();
    expect(screen.getByText('del AppSheet')).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Ambulancia'), { target: { value: '7' } });
    await waitFor(() => expect(almacenService.movimientos).toHaveBeenLastCalledWith(expect.objectContaining({ vehicle_id: '7', page: 1 })));
  });
});
