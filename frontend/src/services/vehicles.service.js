import api from './api.js';

export const vehiclesService = {
  list(params = {}) {
    return api.get('/vehicles', { params }).then(r => r.data);
  },
  get(id) {
    return api.get(`/vehicles/${id}`).then(r => r.data.data);
  },
  create(data) {
    return api.post('/vehicles', data).then(r => r.data.data);
  },
  update(id, data) {
    return api.put(`/vehicles/${id}`, data).then(r => r.data.data);
  },
  delete(id) {
    return api.delete(`/vehicles/${id}`).then(r => r.data);
  },
  getImages(id, params = {}) {
    return api.get(`/vehicles/${id}/images`, { params }).then(r => r.data.data);
  },
  getHistory(id) {
    return api.get(`/vehicles/${id}/historial`).then(r => r.data.data);
  },
  uploadImage(id, formData) {
    return api.post(`/vehicles/${id}/images`, formData, {
      headers: { 'Content-Type': undefined },
    }).then(r => r.data.data);
  },

  // ── Incidencias ─────────────────────────────────────────────
  listIncidencias(id) {
    return api.get(`/vehicles/${id}/incidencias`).then(r => r.data.data);
  },
  createIncidencia(id, data) {
    return api.post(`/vehicles/${id}/incidencias`, data).then(r => r.data.data);
  },
  updateIncidencia(vehicleId, incId, data) {
    return api.patch(`/vehicles/${vehicleId}/incidencias/${incId}`, data).then(r => r.data.data);
  },

  // ── Revisiones / mantenimiento ───────────────────────────────
  listRevisiones(id) {
    return api.get(`/vehicles/${id}/revisiones`).then(r => r.data.data);
  },
  createRevision(id, data) {
    return api.post(`/vehicles/${id}/revisiones`, data).then(r => r.data.data);
  },
  updateRevision(vehicleId, revId, data) {
    return api.put(`/vehicles/${vehicleId}/revisiones/${revId}`, data).then(r => r.data.data);
  },
  deleteRevision(vehicleId, revId) {
    return api.delete(`/vehicles/${vehicleId}/revisiones/${revId}`).then(r => r.data);
  },

  // ── Tarjeta de transporte: próximas caducidades ──────────────
  listTarjetaTransporteProximas(dias = 60) {
    return api.get('/vehicles/tarjeta-transporte/proximas', { params: { dias } })
      .then(r => r.data.data);
  },

  // ── Alertas de caducidad (ITV + ITS + Tarjeta) — solo admin ──
  listAlertas(dias = 60) {
    return api.get('/vehicles/alertas', { params: { dias } })
      .then(r => r.data.data);
  },
};
