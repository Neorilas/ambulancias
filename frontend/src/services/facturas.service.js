import api from './api.js';
import { SUBIDA_FOTO_TIMEOUT_MS } from '../utils/subidaFotos.js';

/**
 * services/facturas.service.js
 * Facturas de proveedores. Solo admin y superadmin: cualquier otro se lleva
 * un 403 del backend (routes/facturas.routes.js).
 */

/** Con responseType 'blob' el JSON de error llega también como Blob. */
async function mensajeDeError(err, porDefecto) {
  let mensaje = err.response?.data?.message;
  if (!mensaje && err.response?.data?.text) {
    try { mensaje = JSON.parse(await err.response.data.text())?.message; } catch { /* no era JSON */ }
  }
  return Object.assign(new Error(mensaje || porDefecto), { status: err.response?.status });
}

export const facturasService = {
  /** Todas, la más reciente primero, sin el PDF. */
  list() {
    return api.get('/facturas').then(r => r.data.data);
  },

  /** `datos`: { proveedor, numero, fecha_emision ('YYYY-MM-DD'), importe?, notas?, fichero (File) } */
  async subir(datos) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(datos)) {
      if (v !== undefined && v !== null && v !== '') fd.append(k, v);
    }
    try {
      // Sin el JSON por defecto de api.js: el navegador pone el multipart con su boundary.
      // Timeout de una subida, no el de 30 s: un PDF de varios MB con 4G flojo no cabe.
      const r = await api.post('/facturas', fd, {
        headers: { 'Content-Type': undefined },
        timeout: SUBIDA_FOTO_TIMEOUT_MS,
      });
      return r.data.data;
    } catch (err) {
      throw await mensajeDeError(err, 'No se pudo subir la factura');
    }
  },

  /**
   * Va por axios (con el token) y no por un <a href>, que no lleva
   * Authorization; el blob se entrega al navegador y se suelta.
   */
  async descargar(factura, nombre) {
    let r;
    try {
      r = await api.get(`/facturas/${factura.id}/descarga`, { responseType: 'blob' });
    } catch (err) {
      throw await mensajeDeError(err, 'No se pudo descargar la factura');
    }
    const url = URL.createObjectURL(r.data);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  },

  /** { configurado, buzon, ultima: { at, ok, revisados, importadas, ya_estaban, descartados, error? } | null } */
  estadoBuzon() {
    return api.get('/facturas/buzon').then(r => r.data.data);
  },

  /** Revisa el buzón ahora. Devuelve el mismo estado, con la revisión recién hecha. */
  async revisarBuzon() {
    try {
      // Una revisión con varios PDF puede pasar de los 30 s por defecto.
      const r = await api.post('/facturas/buzon/revisar', {}, { timeout: SUBIDA_FOTO_TIMEOUT_MS });
      return r.data.data;
    } catch (err) {
      throw await mensajeDeError(err, 'No se pudo revisar el buzón');
    }
  },

  eliminar(id) {
    return api.delete(`/facturas/${id}`).then(r => r.data);
  },
};
