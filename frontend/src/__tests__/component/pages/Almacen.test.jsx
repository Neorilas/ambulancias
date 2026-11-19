import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../services/almacen.service.js', () => ({
  almacenService: {
    productos: vi.fn(), producto: vi.fn(), crearProducto: vi.fn(), guardarProducto: vi.fn(),
    movimiento: vi.fn(), recuento: vi.fn(), recuentoProducto: vi.fn(), corregirCaducidad: vi.fn(), movimientos: vi.fn(),
  },
}));
vi.mock('../../../services/vehicles.service.js', () => ({
  vehiclesService: { list: vi.fn() },
}));

vi.mock('../../../services/inventario.service.js', () => ({
  inventarioService: { ambulancias: vi.fn(), deAmbulancia: vi.fn(), anadir: vi.fn(), guardar: vi.fn(), quitar: vi.fn() },
}));
vi.mock('../../../services/asignaciones.service.js', () => ({
  asignacionesService: { catalogoMaterial: vi.fn().mockResolvedValue([]) },
}));

import { inventarioService } from '../../../services/inventario.service.js';
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

    // [0] es el del producto entero, arriba; [1] el del primer lote
    fireEvent.click(screen.getAllByRole('button', { name: 'Recuento' })[1]);
    const modal = (await screen.findByText('Recuento del lote')).closest('div.relative');
    fireEvent.change(within(modal).getByLabelText(/Contadas/), { target: { value: '6' } });
    expect(within(modal).getByText('-2')).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: 'Apuntar recuento' }));
    await waitFor(() => expect(almacenService.recuento).toHaveBeenCalledWith(10, 6, ''));
    expect(await screen.findByText('Recuento apuntado')).toBeInTheDocument();
  });

  it('el recuento del producto cuenta varios lotes de una vez y usa el lote vacío si la caducidad coincide', async () => {
    almacenService.recuentoProducto.mockResolvedValue({
      producto: { ...PRODUCTOS[0], stock: 13 }, ajustes: [], message: 'Recuento apuntado: 2 lotes ajustados',
    });
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Guedel 3' }));
    await screen.findByText('Lotes');
    fireEvent.click(screen.getAllByRole('button', { name: 'Recuento' })[0]);
    const modal = (await screen.findByText('Recuento del producto')).closest('div.relative');

    fireEvent.click(within(modal).getByRole('button', { name: 'Apuntar recuento' }));
    expect(await within(modal).findByRole('alert')).toHaveTextContent('Pon lo contado de al menos un lote');

    fireEvent.change(within(modal).getByLabelText('Contadas del lote 31/10/2030'), { target: { value: '5' } });
    expect(within(modal).getByText('-3')).toBeInTheDocument();
    fireEvent.change(within(modal).getByLabelText('Contadas del lote No caduca'), { target: { value: '4' } });
    expect(within(modal).getByText('cuadra')).toBeInTheDocument();

    // una caducidad «nueva» que ya tiene lote vacío se cuenta en ese lote
    fireEvent.click(within(modal).getByRole('button', { name: /Otra caducidad/ }));
    fireEvent.change(within(modal).getByLabelText('Caducidad de la fila nueva'), { target: { value: '2025-01-01' } });
    fireEvent.change(within(modal).getByLabelText('Contadas de la fila nueva'), { target: { value: '2' } });
    fireEvent.click(within(modal).getByRole('button', { name: /Otra caducidad/ }));
    fireEvent.change(within(modal).getAllByLabelText('Caducidad de la fila nueva')[1], { target: { value: '2032-05-31' } });
    fireEvent.change(within(modal).getAllByLabelText('Contadas de la fila nueva')[1], { target: { value: '2' } });

    fireEvent.click(within(modal).getByRole('button', { name: 'Apuntar recuento' }));
    await waitFor(() => expect(almacenService.recuentoProducto).toHaveBeenCalledWith(1, {
      lotes: [{ lote_id: 10, stock_real: 5 }, { lote_id: 11, stock_real: 4 }, { lote_id: 12, stock_real: 2 }],
      nuevos: [{ caducidad: '2032-05-31', stock_real: 2 }],
      notas: '',
    }));
    expect(await screen.findByText('Recuento apuntado: 2 lotes ajustados')).toBeInTheDocument();
  });

  it('el recuento del producto no deja una fila nueva con la caducidad de un lote con existencias', async () => {
    montar();
    fireEvent.click(await screen.findByRole('button', { name: 'Guedel 3' }));
    await screen.findByText('Lotes');
    fireEvent.click(screen.getAllByRole('button', { name: 'Recuento' })[0]);
    const modal = (await screen.findByText('Recuento del producto')).closest('div.relative');
    fireEvent.click(within(modal).getByRole('button', { name: /Otra caducidad/ }));
    fireEvent.change(within(modal).getByLabelText('Caducidad de la fila nueva'), { target: { value: '2030-10-31' } });
    fireEvent.change(within(modal).getByLabelText('Contadas de la fila nueva'), { target: { value: '1' } });
    fireEvent.click(within(modal).getByRole('button', { name: 'Apuntar recuento' }));
    expect(await within(modal).findByRole('alert')).toHaveTextContent('cuéntalo en su fila');
    expect(almacenService.recuentoProducto).not.toHaveBeenCalled();
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
    // El destino y la ambulancia no salen hasta elegir Salida → A ambulancia
    expect(screen.queryByRole('group', { name: 'Destino de la salida' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Ambulancia')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Salida' }));
    await waitFor(() => expect(almacenService.movimientos).toHaveBeenLastCalledWith(expect.objectContaining({ tipo: 'salida', destino: '' })));
    fireEvent.click(screen.getByRole('button', { name: 'A ambulancia' }));
    fireEvent.change(await screen.findByLabelText('Ambulancia'), { target: { value: '7' } });
    await waitFor(() => expect(almacenService.movimientos).toHaveBeenLastCalledWith(expect.objectContaining({
      tipo: 'salida', destino: 'ambulancia', vehicle_id: '7', page: 1,
    })));
    // Cambiar de tipo borra el destino y la ambulancia
    fireEvent.click(screen.getByRole('button', { name: 'Recuento' }));
    await waitFor(() => expect(almacenService.movimientos).toHaveBeenLastCalledWith(expect.objectContaining({
      tipo: 'ajuste', destino: '', vehicle_id: '',
    })));
    expect(screen.queryByLabelText('Ambulancia')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recuento' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('Movimientos: «A enfermería» sin más, «A otro sitio» con texto libre', async () => {
    montar('/almacen?vista=movimientos&tipo=salida');
    fireEvent.click(await screen.findByRole('button', { name: 'A enfermería' }));
    await waitFor(() => expect(almacenService.movimientos).toHaveBeenLastCalledWith(expect.objectContaining({ destino: 'enfermeria', buscar: '' })));
    expect(screen.queryByLabelText('Buscar destino')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'A otro sitio' }));
    fireEvent.change(await screen.findByLabelText('Buscar destino'), { target: { value: 'obra' } });
    await waitFor(() => expect(almacenService.movimientos).toHaveBeenLastCalledWith(expect.objectContaining({
      tipo: 'salida', destino: 'otros', buscar: 'obra', page: 1,
    })));
  });

  it('Movimientos: un enlace viejo con el tipo exacto abre el filtro nuevo', async () => {
    montar('/almacen?vista=movimientos&tipo=salida_ambulancia&ambulancia=7');
    await waitFor(() => expect(almacenService.movimientos).toHaveBeenLastCalledWith(expect.objectContaining({
      tipo: 'salida', destino: 'ambulancia', vehicle_id: '7',
    })));
    expect(await screen.findByLabelText('Ambulancia')).toHaveValue('7');
    expect(screen.getByRole('button', { name: 'A ambulancia' })).toHaveAttribute('aria-pressed', 'true');
  });

  describe('vista Ambulancias (inventario de cada una)', () => {
    beforeEach(() => {
      inventarioService.ambulancias.mockResolvedValue([
        { id: 9, alias: 'UVI-10', matricula: '9999ZZZ', lineas: 0, unidades: 0, proxima_caducidad: null },
        { id: 7, alias: 'UVI-3', matricula: '1234ABC', lineas: 2, unidades: 6, proxima_caducidad: '2020-01-01' },
      ]);
      inventarioService.deAmbulancia.mockResolvedValue({
        vehiculo: { id: 7 },
        lineas: [{ id: 1, producto_id: 5, nombre: 'Tubo de Mayo', presentacion: 'Unidad', caducidad: null, cantidad: 4, notas: null, del_almacen: true }],
      });
    });

    it('lista las ambulancias por nombre (numérico) con su resumen y abre el inventario de la elegida', async () => {
      montar('/almacen?vista=ambulancias');
      const lista = await screen.findByRole('list', { name: 'Ambulancias' });
      const filas = within(lista).getAllByRole('button');
      expect(filas.map(b => b.textContent)).toEqual([
        expect.stringMatching(/^UVI-3 · 1234ABC2 elementoscaducado hace/),
        expect.stringMatching(/^UVI-10 · 9999ZZZVacío/),
      ]);
      fireEvent.click(filas[0]);
      expect(await screen.findByText('Tubo de Mayo')).toBeInTheDocument();
      expect(inventarioService.deAmbulancia).toHaveBeenCalledWith(7);
      // El administrador puede añadir desde aquí
      expect(screen.getByRole('button', { name: 'Añadir' })).toBeInTheDocument();
      expect(screen.getByLabelText('Ambulancia')).toHaveValue('7');
    });

    it('la elegida va en la URL (?inv=), aparte del filtro de Movimientos', async () => {
      montar('/almacen?vista=ambulancias&inv=7&ambulancia=9');
      expect(await screen.findByText('Tubo de Mayo')).toBeInTheDocument();
      expect(inventarioService.deAmbulancia).toHaveBeenCalledWith(7);
    });

    it('si no cargan las ambulancias lo dice, con «Reintentar»', async () => {
      inventarioService.ambulancias.mockRejectedValueOnce(new Error('No se pudieron cargar las ambulancias'));
      montar('/almacen?vista=ambulancias');
      expect(await screen.findByText('No se pudieron cargar las ambulancias')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
      expect(await screen.findByRole('list', { name: 'Ambulancias' })).toBeInTheDocument();
    });
  });
});
