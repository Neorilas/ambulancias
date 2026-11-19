import api from './api.js';

/**
 * services/inventario.service.js
 * Inventario de cada ambulancia (v46). Lo ven admin, gestor y superadmin; el
 * resto se lleva el 404 del backend. Solo admin y superadmin lo cambian (el
 * gestor, 403). routes/inventario.routes.js.
 */

async function pedir(promesa, porDefecto) {
  try {
    const r = await promesa;
    return r.data;
  } catch (err) {
    throw Object.assign(new Error(err.response?.data?.message || porDefecto), { status: err.response?.status });
  }
}

export const inventarioService = {
  /** Las ambulancias vivas con { lineas, unidades, proxima_caducidad }. */
  ambulancias() {
    return pedir(api.get('/inventario/ambulancias'), 'No se pudieron cargar las ambulancias').then(d => d.data);
  },
  /** { vehiculo, lineas } de una ambulancia. */
  deAmbulancia(vehicleId) {
    return pedir(api.get(`/inventario/ambulancias/${vehicleId}`), 'No se pudo cargar el inventario').then(d => d.data);
  },
  /** Devuelve { data: línea, message } («Añadido…» o «Sumado: ahora hay N»). */
  anadir(vehicleId, datos) {
    return pedir(api.post(`/inventario/ambulancias/${vehicleId}/lineas`, datos), 'No se pudo añadir');
  },
  guardar(id, datos) {
    return pedir(api.put(`/inventario/lineas/${id}`, datos), 'No se pudo guardar').then(d => d.data);
  },
  quitar(id) {
    return pedir(api.delete(`/inventario/lineas/${id}`), 'No se pudo quitar');
  },
};
