import api from './api.js';

/**
 * Trabajos (v33, el trabajo padre): sus ambulancias son asignaciones y se
 * operan con `asignaciones.service` (activar, fotos, llegada, finalizar). Aquí
 * solo queda lo del trabajo: datos, coordinador, quién ve qué y el cierre.
 *
 * Las rutas del ciclo por vehículo del modelo v25 siguen vivas en el backend
 * hasta la fase 6 del plan, pero ninguna pantalla las usa ya.
 */
export const trabajosService = {
  list(params = {}) {
    return api.get('/trabajos', { params }).then(r => r.data);
  },
  listCalendario(params = {}) {
    return api.get('/trabajos/calendario', { params }).then(r => r.data.data);
  },
  misTrab(params = {}) {
    return api.get('/trabajos/mis-trabajos', { params }).then(r => r.data);
  },
  get(id) {
    return api.get(`/trabajos/${id}`).then(r => r.data.data);
  },
  /** El trabajo con su coordinador y al menos una ambulancia (`asignaciones`). */
  create(data) {
    return api.post('/trabajos', data).then(r => r.data.data);
  },
  update(id, data) {
    return api.put(`/trabajos/${id}`, data).then(r => r.data.data);
  },
  delete(id) {
    return api.delete(`/trabajos/${id}`).then(r => r.data);
  },
  /** Lo cierra su coordinador (o gestión) con todas sus ambulancias finalizadas. */
  cerrar(id) {
    return api.post(`/trabajos/${id}/cerrar`).then(r => r.data.data);
  },
};
