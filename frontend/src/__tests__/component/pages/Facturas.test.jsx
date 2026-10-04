import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../../services/facturas.service.js', () => ({
  facturasService: { list: vi.fn(), leer: vi.fn(), subir: vi.fn(), descargar: vi.fn(), eliminar: vi.fn(), estadoBuzon: vi.fn(), revisarBuzon: vi.fn() },
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
    facturasService.estadoBuzon.mockResolvedValue({ configurado: false, buzon: null, ultima: null });
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

  describe('subir (paso 1: el PDF se lee; paso 2: se revisa y completa)', () => {
    const LEIDA = { proveedor: 'Google Ads', numero: '5730000000', fecha_emision: '2026-09-15', importe: 70 };

    async function abrir() {
      montar();
      await screen.findByText('5705694492');
      fireEvent.click(screen.getByText('Subir factura'));
    }

    /** Elige el PDF y pasa al paso 2 con lo que devuelva el lector. */
    async function leer(lectura, fichero = pdf()) {
      if (lectura instanceof Error) facturasService.leer.mockRejectedValue(lectura);
      else facturasService.leer.mockResolvedValue(lectura);
      fireEvent.change(screen.getByLabelText(/PDF de la factura/), { target: { files: [fichero] } });
      fireEvent.click(screen.getByText('Siguiente'));
      await screen.findByText('Revisar los datos · 2 de 2');
      return fichero;
    }

    it('paso 1: sin PDF no se puede seguir; lo que no es PDF o pesa demasiado no se manda a leer', async () => {
      await abrir();
      expect(screen.getByText('Subir factura · 1 de 2')).toBeInTheDocument();
      expect(screen.getByText('Siguiente')).toBeDisabled();

      const fichero = screen.getByLabelText(/PDF de la factura/);
      fireEvent.change(fichero, { target: { files: [pdf('foto.jpg', 'image/jpeg')] } });
      fireEvent.click(screen.getByText('Siguiente'));
      expect(await screen.findByText('Tiene que ser un PDF')).toBeInTheDocument();

      fireEvent.change(fichero, { target: { files: [pdf('grande.pdf', 'application/pdf', 11 * 1024 * 1024)] } });
      fireEvent.click(screen.getByText('Siguiente'));
      expect(await screen.findByText('El PDF no puede pasar de 10 MB')).toBeInTheDocument();
      expect(facturasService.leer).not.toHaveBeenCalled();
    });

    it('paso 1: si el backend dice que no es un PDF de verdad, se queda en el paso 1', async () => {
      facturasService.leer.mockRejectedValue(Object.assign(new Error('El fichero no es un PDF'), { status: 400 }));
      await abrir();
      fireEvent.change(screen.getByLabelText(/PDF de la factura/), { target: { files: [pdf()] } });
      fireEvent.click(screen.getByText('Siguiente'));
      expect(await screen.findByText('El fichero no es un PDF')).toBeInTheDocument();
      expect(screen.getByText('Subir factura · 1 de 2')).toBeInTheDocument();
    });

    it('todo leído: el formulario sale relleno y se guarda con el mismo PDF', async () => {
      const nueva = { id: 9, ...LEIDA, notas: null, nombre_fichero: 'f.pdf', tamano: 10, origen: 'manual' };
      facturasService.subir.mockResolvedValue(nueva);
      await abrir();
      const fichero = await leer({ con_texto: true, datos: LEIDA, duplicada: false });

      expect(facturasService.leer).toHaveBeenCalledWith(fichero);
      expect(screen.getByText(/Se han leído todos los datos/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Nº de factura/)).toHaveValue('5730000000');
      expect(screen.getByLabelText(/Importe/)).toHaveValue('70,00');
      expect(screen.getAllByText('Leído del PDF, compruébalo')).toHaveLength(4);

      fireEvent.click(screen.getByText('Guardar factura'));
      await waitFor(() => expect(facturasService.subir).toHaveBeenCalledWith({
        proveedor: 'Google Ads', numero: '5730000000', fecha_emision: '2026-09-15', importe: '70,00', notas: '', fichero,
      }));
      expect(await screen.findByText('5730000000')).toBeInTheDocument();
      expect(screen.queryByText('Guardar factura')).not.toBeInTheDocument();
      // En su sitio por fecha: la del 15-09 va detrás de la del 30-09
      expect(within(screen.getAllByRole('row')[2]).getByText('5730000000')).toBeInTheDocument();
    });

    it('lo que falta se marca y hay que rellenarlo a mano antes de guardar', async () => {
      facturasService.subir.mockResolvedValue(null);
      await abrir();
      await leer({ con_texto: true, datos: { proveedor: 'Taller Peñalara', numero: null, fecha_emision: null, importe: 12.5 } });

      expect(screen.getByText(/marcado en ámbar/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Importe/)).toHaveValue('12,50');
      expect(screen.getAllByText('No está en el PDF, rellénalo a mano')).toHaveLength(2);
      expect(screen.getByLabelText(/Nº de factura/).className).toContain('border-warn-500');

      fireEvent.click(screen.getByText('Guardar factura'));
      expect(await screen.findByText('Indica el número de factura')).toBeInTheDocument();
      expect(screen.getByText('Indica la fecha de emisión')).toBeInTheDocument();
      expect(facturasService.subir).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText(/Nº de factura/), { target: { value: ' T-2 ' } });
      fireEvent.change(screen.getByLabelText(/Fecha de emisión/), { target: { value: '2999-01-01' } });
      fireEvent.click(screen.getByText('Guardar factura'));
      expect(await screen.findByText('No puede ser una fecha futura')).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/Fecha de emisión/), { target: { value: '2026-10-01' } });
      fireEvent.click(screen.getByText('Guardar factura'));
      await waitFor(() => expect(facturasService.subir).toHaveBeenCalledWith(expect.objectContaining({
        proveedor: 'Taller Peñalara', numero: 'T-2', fecha_emision: '2026-10-01', importe: '12,50',
      })));
    });

    it('un PDF escaneado o un fallo al leer pasan igual al paso 2, vacío y con aviso', async () => {
      await abrir();
      await leer({ con_texto: false, datos: { proveedor: null, numero: null, fecha_emision: null, importe: null } });
      expect(screen.getByText(/parece escaneado/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Proveedor/, { selector: 'input' })).toHaveValue('');

      fireEvent.click(screen.getByText('Atrás'));
      await leer(new Error('No se pudo leer la factura'));
      expect(screen.getByText(/No se ha podido leer la factura \(No se pudo leer la factura\)/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Nº de factura/)).toHaveValue('');
    });

    it('avisa antes de guardar si esa factura ya está; si el backend la rechaza, lo dice y sigue abierto', async () => {
      facturasService.subir.mockRejectedValue(new Error('Ya hay una factura 5705694492 de Google Ads'));
      await abrir();
      await leer({ con_texto: true, datos: { ...LEIDA, numero: '5705694492' }, duplicada: true });
      expect(screen.getByText(/Ya hay una factura 5705694492 de Google Ads \(30\/09\/2026\)/)).toBeInTheDocument();

      fireEvent.click(screen.getByText('Guardar factura'));
      expect(await screen.findByText('Ya hay una factura 5705694492 de Google Ads')).toBeInTheDocument();
      expect(screen.getByText('Guardar factura')).toBeInTheDocument();
    });

    it('Cancelar cierra sin leer ni enviar', async () => {
      await abrir();
      fireEvent.click(screen.getByText('Cancelar'));
      expect(screen.queryByText('Siguiente')).not.toBeInTheDocument();
      expect(facturasService.leer).not.toHaveBeenCalled();
    });
  });

  describe('buzón de facturas', () => {
    const hace = (min) => new Date(Date.now() - min * 60000).toISOString();

    it('sin buzón configurado no se pinta nada del buzón', async () => {
      montar();
      await screen.findByText('5705694492');
      expect(screen.queryByText('Revisar ahora')).not.toBeInTheDocument();
    });

    it('enseña el buzón y la última revisión', async () => {
      facturasService.estadoBuzon.mockResolvedValue({ configurado: true, buzon: 'facturas@vapss.net',
        ultima: { at: hace(5), ok: true, importadas: 0 } });
      montar();
      expect(await screen.findByText('facturas@vapss.net')).toBeInTheDocument();
      expect(screen.getByText(/revisado hace 5 min, nada nuevo/)).toBeInTheDocument();
    });

    it('avisa de los correos descartados por la firma y de los que no se pudieron guardar', async () => {
      facturasService.estadoBuzon.mockResolvedValue({ configurado: true, buzon: 'facturas@vapss.net',
        ultima: { at: hace(5), ok: true, importadas: 1, sin_firma: 2, errores: 1 } });
      montar();
      expect(await screen.findByText(/2 sin firma válida del remitente/)).toBeInTheDocument();
      expect(screen.getByText(/1 no se ha podido guardar/)).toBeInTheDocument();
    });

    it('si la última revisión falló, dice por qué', async () => {
      facturasService.estadoBuzon.mockResolvedValue({ configurado: true, buzon: 'facturas@vapss.net',
        ultima: { at: hace(120), ok: false, error: 'Usuario o contraseña del buzón incorrectos' } });
      montar();
      expect(await screen.findByText(/falló hace 2 h: Usuario o contraseña del buzón incorrectos/)).toBeInTheDocument();
    });

    it('sin revisiones aún lo dice, y si el estado no carga la pantalla sigue', async () => {
      facturasService.estadoBuzon.mockResolvedValueOnce({ configurado: true, buzon: 'facturas@vapss.net', ultima: null });
      const { unmount } = montar();
      expect(await screen.findByText(/todavía no se ha revisado/)).toBeInTheDocument();
      unmount();

      facturasService.estadoBuzon.mockRejectedValueOnce(new Error('x'));
      montar();
      expect(await screen.findByText('5705694492')).toBeInTheDocument();
    });

    it('«Revisar ahora» con facturas nuevas avisa y recarga la lista', async () => {
      facturasService.estadoBuzon.mockResolvedValue({ configurado: true, buzon: 'facturas@vapss.net', ultima: null });
      facturasService.revisarBuzon.mockResolvedValue({ configurado: true, buzon: 'facturas@vapss.net',
        ultima: { at: hace(0), ok: true, importadas: 2 } });
      montar();
      fireEvent.click(await screen.findByText('Revisar ahora'));

      expect(await screen.findByText('2 facturas nuevas del buzón')).toBeInTheDocument();
      expect(screen.getByText(/revisado ahora mismo, 2 nuevas/)).toBeInTheDocument();
      await waitFor(() => expect(facturasService.list).toHaveBeenCalledTimes(2));
    });

    it('«Revisar ahora» sin nada nuevo, con fallo del buzón o con error de red', async () => {
      facturasService.estadoBuzon.mockResolvedValue({ configurado: true, buzon: 'facturas@vapss.net', ultima: null });
      facturasService.revisarBuzon
        .mockResolvedValueOnce({ configurado: true, ultima: { at: hace(0), ok: true, importadas: 0 } })
        .mockResolvedValueOnce({ configurado: true, ultima: { at: hace(0), ok: false, error: 'Mailbox busy' } })
        .mockRejectedValueOnce(new Error('No se pudo revisar el buzón'));
      montar();
      const boton = await screen.findByText('Revisar ahora');

      fireEvent.click(boton);
      expect(await screen.findByText('No hay facturas nuevas en el buzón')).toBeInTheDocument();
      fireEvent.click(screen.getByText('Revisar ahora'));
      expect(await screen.findAllByText(/Mailbox busy/)).not.toHaveLength(0);
      fireEvent.click(screen.getByText('Revisar ahora'));
      expect(await screen.findByText('No se pudo revisar el buzón')).toBeInTheDocument();
      expect(facturasService.list).toHaveBeenCalledTimes(1);
    });
  });
});
