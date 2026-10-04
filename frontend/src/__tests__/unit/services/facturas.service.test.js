import { describe, it, expect, vi, beforeEach } from 'vitest';
import { facturasService } from '../../../services/facturas.service';
import api from '../../../services/api';
import { SUBIDA_FOTO_TIMEOUT_MS } from '../../../utils/subidaFotos';

vi.mock('../../../services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

describe('facturas.service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list llama a GET /facturas', async () => {
    api.get.mockResolvedValueOnce({ data: { data: [{ id: 1 }] } });
    expect(await facturasService.list()).toEqual([{ id: 1 }]);
    expect(api.get).toHaveBeenCalledWith('/facturas');
  });

  it('subir manda un multipart sin los campos vacíos y con el timeout de las subidas', async () => {
    api.post.mockResolvedValueOnce({ data: { data: { id: 5 } } });
    const fichero = new File(['%PDF-'], 'f.pdf', { type: 'application/pdf' });

    const r = await facturasService.subir({ proveedor: 'Google Ads', numero: '1', fecha_emision: '2026-09-30', importe: '', notas: null, fichero });

    expect(r).toEqual({ id: 5 });
    const [url, fd, config] = api.post.mock.calls[0];
    expect(url).toBe('/facturas');
    expect(fd.get('proveedor')).toBe('Google Ads');
    expect(fd.get('fichero')).toBeInstanceOf(File);
    expect(fd.has('importe')).toBe(false);
    expect(fd.has('notas')).toBe(false);
    expect(config).toEqual({ headers: { 'Content-Type': undefined }, timeout: SUBIDA_FOTO_TIMEOUT_MS });
  });

  it('subir: el mensaje del backend llega al error, o uno genérico', async () => {
    api.post.mockRejectedValueOnce({ response: { status: 409, data: { message: 'Ya hay una factura 1 de Google Ads' } } });
    await expect(facturasService.subir({})).rejects.toMatchObject({ message: 'Ya hay una factura 1 de Google Ads', status: 409 });

    api.post.mockRejectedValueOnce(new Error('Network Error'));
    await expect(facturasService.subir({})).rejects.toMatchObject({ message: 'No se pudo subir la factura' });
  });

  it('descargar pide el blob con el token y lo entrega al navegador con el nombre dado', async () => {
    api.get.mockResolvedValueOnce({ data: new Blob(['%PDF-']) });
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    let descargado;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { descargado = this.download; });

    await facturasService.descargar({ id: 3 }, 'Factura_Google_Ads_1.pdf');

    expect(api.get).toHaveBeenCalledWith('/facturas/3/descarga', { responseType: 'blob' });
    expect(descargado).toBe('Factura_Google_Ads_1.pdf');
    click.mockRestore();
  });

  it('descargar: con error, saca el mensaje del JSON que llega como Blob', async () => {
    const cuerpo = new Blob([JSON.stringify({ success: false, message: 'Factura no encontrado' })]);
    api.get.mockRejectedValueOnce({ response: { status: 404, data: cuerpo } });
    await expect(facturasService.descargar({ id: 9 }, 'x.pdf')).rejects.toMatchObject({ message: 'Factura no encontrado', status: 404 });

    api.get.mockRejectedValueOnce({ response: { status: 500, data: new Blob(['no es json']) } });
    await expect(facturasService.descargar({ id: 9 }, 'x.pdf')).rejects.toMatchObject({ message: 'No se pudo descargar la factura' });
  });

  it('eliminar llama a DELETE /facturas/:id', async () => {
    api.delete.mockResolvedValueOnce({ data: { success: true } });
    await facturasService.eliminar(4);
    expect(api.delete).toHaveBeenCalledWith('/facturas/4');
  });

  it('estadoBuzon llama a GET /facturas/buzon', async () => {
    api.get.mockResolvedValueOnce({ data: { data: { configurado: true } } });
    expect(await facturasService.estadoBuzon()).toEqual({ configurado: true });
    expect(api.get).toHaveBeenCalledWith('/facturas/buzon');
  });

  it('revisarBuzon llama a POST /facturas/buzon/revisar con timeout largo y explica los fallos', async () => {
    api.post.mockResolvedValueOnce({ data: { data: { ultima: { ok: true } } } });
    expect(await facturasService.revisarBuzon()).toEqual({ ultima: { ok: true } });
    expect(api.post).toHaveBeenCalledWith('/facturas/buzon/revisar', {}, { timeout: SUBIDA_FOTO_TIMEOUT_MS });

    api.post.mockRejectedValueOnce({ response: { status: 409, data: { message: 'El buzón de facturas no está configurado en el servidor' } } });
    await expect(facturasService.revisarBuzon()).rejects.toMatchObject({ status: 409, message: 'El buzón de facturas no está configurado en el servidor' });
  });
});
