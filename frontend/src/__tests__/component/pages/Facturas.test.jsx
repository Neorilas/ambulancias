import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../services/facturas.service.js', () => ({
  facturasService: { list: vi.fn(), subir: vi.fn(), descargar: vi.fn(), eliminar: vi.fn() },
}));

import { facturasService }      from '../../../services/facturas.service.js';
import { NotificationProvider, useNotification } from '../../../context/NotificationContext.jsx';
import Facturas                 from '../../../pages/facturas/Facturas.jsx';

const FACTURAS = [
  { id: 3, proveedor: 'Google Ads', numero: '5705694492', fecha_emision: '2026-09-30', importe: 65.23,
    notas: null, nombre_fichero: 'a.pdf', tamano: 90000, origen: 'manual' },
  { id: 2, proveedor: 'Google Ads', numero: '5680013365', fecha_emision: '2026-08-31', importe: 57.2,
    notas: 'agosto', nombre_fichero: 'b.pdf', tamano: 90000, origen: 'correo' },
  { id: 1, proveedor: 'Taller Peñalara', numero: 'T-1', fecha_emision: '2025-12-15', importe: null,
    notas: null, nombre_fichero: 'c.pdf', tamano: 2000000, origen: 'manual' },
];

// El provider guarda los avisos pero no los pinta (eso lo hace el Layout).
function Avisos() {
  const { toasts } = useNotification();
  return toasts.map(t => <p key={t.id}>{t.message}</p>);
}

function montar() {
  return render(
    <NotificationProvider>
      <MemoryRouter><Facturas /></MemoryRouter>
      <Avisos />
    </NotificationProvider>
  );
}

const pdf = (nombre = 'f.pdf', tipo = 'application/pdf', bytes = 10) =>
  new File([new Uint8Array(bytes)], nombre, { type: tipo });

describe('Facturas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    facturasService.list.mockResolvedValue(FACTURAS);
  });

  it('lista las facturas con su total y filtra por año y proveedor', async () => {
    montar();

    expect(await screen.findByText('5705694492')).toBeInTheDocument();
    expect(screen.getByText('30/09/2026')).toBeInTheDocument();
    expect(screen.getByText('llegó por correo')).toBeInTheDocument();
    expect(screen.getByText(/1 sin importe/)).toBeInTheDocument();
    expect(screen.getByText('3 facturas', { exact: false })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Año'), { target: { value: '2026' } });
    expect(screen.queryByText('T-1')).not.toBeInTheDocument();
    expect(screen.getByText(/2 facturas/)).toBeInTheDocument();
    expect(screen.getByText('122,43 €')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Año'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Proveedor'), { target: { value: 'Taller Peñalara' } });
    expect(screen.getByText('T-1')).toBeInTheDocument();
    expect(screen.queryByText('5705694492')).not.toBeInTheDocument();
  });

  it('sin facturas lo dice', async () => {
    facturasService.list.mockResolvedValue([]);
    montar();
    expect(await screen.findByText('Todavía no hay facturas')).toBeInTheDocument();
  });

  it('si no carga, avisa', async () => {
    facturasService.list.mockRejectedValue(new Error('x'));
    montar();
    expect(await screen.findByText('No se pudieron cargar las facturas')).toBeInTheDocument();
  });

  it('descarga con el mismo nombre que pone el backend', async () => {
    facturasService.descargar.mockResolvedValue();
    montar();
    await screen.findByText('5705694492');
    fireEvent.click(screen.getAllByText('Descargar')[0]);
    await waitFor(() => expect(facturasService.descargar)
      .toHaveBeenCalledWith(FACTURAS[0], 'Factura_Google_Ads_5705694492.pdf'));
  });

  it('un fallo al descargar sale como aviso', async () => {
    facturasService.descargar.mockRejectedValue(new Error('Factura no encontrado'));
    montar();
    await screen.findByText('5705694492');
    fireEvent.click(screen.getAllByText('Descargar')[0]);
    expect(await screen.findByText('Factura no encontrado')).toBeInTheDocument();
  });

  it('elimina tras confirmar', async () => {
    facturasService.eliminar.mockResolvedValue({});
    montar();
    await screen.findByText('5705694492');
    fireEvent.click(screen.getByLabelText('Eliminar la factura 5705694492'));
    const dialogo = screen.getByText(/Se borrará la factura 5705694492 de Google Ads/).closest('div.relative');
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }));

    await waitFor(() => expect(facturasService.eliminar).toHaveBeenCalledWith(3));
    await waitFor(() => expect(screen.queryByText('5705694492')).not.toBeInTheDocument());
  });

  it('si no se puede eliminar, avisa y la deja', async () => {
    facturasService.eliminar.mockRejectedValue({ response: { data: { message: 'Factura no encontrado' } } });
    montar();
    await screen.findByText('5705694492');
    fireEvent.click(screen.getByLabelText('Eliminar la factura 5705694492'));
    const dialogo = screen.getByText(/Se borrará la factura/).closest('div.relative');
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }));
    expect(await screen.findByText('Factura no encontrado')).toBeInTheDocument();
    expect(screen.getByText('5705694492')).toBeInTheDocument();
  });

  describe('subir', () => {
    async function abrir() {
      montar();
      await screen.findByText('5705694492');
      fireEvent.click(screen.getByText('Subir factura'));
    }

    it('no envía sin los obligatorios y lo dice campo a campo', async () => {
      await abrir();
      fireEvent.change(screen.getByLabelText(/Proveedor/, { selector: 'input' }), { target: { value: ' ' } });
      fireEvent.change(screen.getByLabelText(/Importe/), { target: { value: 'mucho' } });
      fireEvent.click(screen.getByText('Guardar factura'));

      expect(await screen.findByText('Indica el proveedor')).toBeInTheDocument();
      expect(screen.getByText('Indica el número de factura')).toBeInTheDocument();
      expect(screen.getByText('Indica la fecha de emisión')).toBeInTheDocument();
      expect(screen.getByText('Importe no válido (ej. 65,23)')).toBeInTheDocument();
      expect(screen.getByText('Elige el PDF de la factura')).toBeInTheDocument();
      expect(facturasService.subir).not.toHaveBeenCalled();
    });

    it('rechaza lo que no es PDF, lo que pesa demasiado y una fecha futura', async () => {
      await abrir();
      const fichero = screen.getByLabelText(/PDF de la factura/);
      fireEvent.change(fichero, { target: { files: [pdf('foto.jpg', 'image/jpeg')] } });
      fireEvent.change(screen.getByLabelText(/Fecha de emisión/), { target: { value: '2999-01-01' } });
      fireEvent.click(screen.getByText('Guardar factura'));
      expect(await screen.findByText('Tiene que ser un PDF')).toBeInTheDocument();
      expect(screen.getByText('No puede ser una fecha futura')).toBeInTheDocument();

      fireEvent.change(fichero, { target: { files: [pdf('grande.pdf', 'application/pdf', 11 * 1024 * 1024)] } });
      fireEvent.click(screen.getByText('Guardar factura'));
      expect(await screen.findByText('El PDF no puede pasar de 10 MB')).toBeInTheDocument();
      expect(facturasService.subir).not.toHaveBeenCalled();
    });

    it('envía, añade la nueva a la lista en su sitio y cierra', async () => {
      const nueva = { id: 9, proveedor: 'Google Ads', numero: '5730000000', fecha_emision: '2026-10-31',
        importe: 70, notas: null, nombre_fichero: 'f.pdf', tamano: 10, origen: 'manual' };
      facturasService.subir.mockResolvedValue(nueva);
      await abrir();

      const fichero = pdf();
      fireEvent.change(screen.getByLabelText(/PDF de la factura/), { target: { files: [fichero] } });
      expect(screen.getByText(/f\.pdf · 1 KB/)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(/Nº de factura/), { target: { value: ' 5730000000 ' } });
      fireEvent.change(screen.getByLabelText(/Fecha de emisión/), { target: { value: '2026-09-15' } });
      fireEvent.change(screen.getByLabelText(/Importe/), { target: { value: '70,00' } });
      fireEvent.click(screen.getByText('Guardar factura'));

      await waitFor(() => expect(facturasService.subir).toHaveBeenCalledWith({
        proveedor: 'Google Ads', numero: '5730000000', fecha_emision: '2026-09-15',
        importe: '70,00', notas: '', fichero,
      }));
      expect(await screen.findByText('5730000000')).toBeInTheDocument();
      expect(screen.queryByText('Guardar factura')).not.toBeInTheDocument();
      const filas = screen.getAllByRole('row');
      expect(within(filas[1]).getByText('5730000000')).toBeInTheDocument();
    });

    it('si el backend la rechaza (duplicada), lo dice y deja el formulario abierto', async () => {
      facturasService.subir.mockRejectedValue(new Error('Ya hay una factura 5705694492 de Google Ads'));
      await abrir();
      fireEvent.change(screen.getByLabelText(/PDF de la factura/), { target: { files: [pdf()] } });
      fireEvent.change(screen.getByLabelText(/Nº de factura/), { target: { value: '5705694492' } });
      fireEvent.change(screen.getByLabelText(/Fecha de emisión/), { target: { value: '2026-09-30' } });
      fireEvent.click(screen.getByText('Guardar factura'));

      expect(await screen.findByText('Ya hay una factura 5705694492 de Google Ads')).toBeInTheDocument();
      expect(screen.getByText('Guardar factura')).toBeInTheDocument();
    });

    it('Cancelar cierra sin enviar', async () => {
      await abrir();
      fireEvent.click(screen.getByText('Cancelar'));
      expect(screen.queryByText('Guardar factura')).not.toBeInTheDocument();
    });
  });
});
