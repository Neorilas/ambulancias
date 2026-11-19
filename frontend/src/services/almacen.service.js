import api from './api.js';

/**
 * services/almacen.service.js
 * Almacén de material. Solo admin y superadmin: cualquier otro se lleva el 404
 * del backend (routes/almacen.routes.js).
 */

/** El mensaje del backend, o el de por defecto. */
function conMensaje(err, porDefecto) {
  return Object.assign(new Error(err.response?.data?.message || porDefecto), { status: err.response?.status });
}

async function pedir(promesa, porDefecto) {
  try {
    const r = await promesa;
    return r.data;
  } catch (err) {
    throw conMensaje(err, porDefecto);
  }
}

export const almacenService = {
  /** El catálogo entero con el stock de cada producto (sin paginar). */
  productos() {
    return pedir(api.get('/almacen/productos'), 'No se pudo cargar el almacén').then(d => d.data);
  },
  /** Un producto con sus lotes. */
  producto(id) {
    return pedir(api.get(`/almacen/productos/${id}`), 'No se pudo cargar el producto').then(d => d.data);
  },
  crearProducto(datos) {
    return pedir(api.post('/almacen/productos', datos), 'No se pudo guardar el producto').then(d => d.data);
  },
  guardarProducto(id, datos) {
    return pedir(api.put(`/almacen/productos/${id}`, datos), 'No se pudo guardar el producto').then(d => d.data);
  },
  /** { id, lote_id, producto } con el producto ya recalculado. */
  movimiento(datos) {
    return pedir(api.post('/almacen/movimientos', datos), 'No se pudo apuntar el movimiento').then(d => d.data);
  },
  recuento(loteId, stockReal, notas) {
    return pedir(api.post(`/almacen/lotes/${loteId}/recuento`, { stock_real: stockReal, notas }), 'No se pudo apuntar el recuento')
      .then(d => ({ ...d.data, message: d.message }));
  },
  /** Recuento de todos los lotes de un producto: { producto, ajustes, message }. */
  recuentoProducto(productoId, { lotes, nuevos, notas }) {
    return pedir(api.post(`/almacen/productos/${productoId}/recuento`, { lotes, nuevos, notas }), 'No se pudo apuntar el recuento')
      .then(d => ({ ...d.data, message: d.message }));
  },
  corregirCaducidad(loteId, caducidad) {
    return pedir(api.put(`/almacen/lotes/${loteId}`, { caducidad }), 'No se pudo corregir la caducidad').then(d => d.data);
  },
  /** { data, pagination }. Filtros: producto_id, vehicle_id, tipo, page, limit. */
  movimientos(params = {}) {
    const limpios = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null));
    return pedir(api.get('/almacen/movimientos', { params: limpios }), 'No se pudieron cargar los movimientos');
  },
};
