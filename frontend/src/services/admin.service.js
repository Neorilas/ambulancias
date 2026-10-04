import api from './api.js';

export const adminService = {
  getStats() {
    return api.get('/admin/stats').then(r => r.data.data);
  },
  listAudit(params = {}) {
    return api.get('/admin/audit', { params }).then(r => r.data);
  },
  listAuditUsers() {
    return api.get('/admin/audit/users').then(r => r.data.data);
  },
  listErrors(params = {}) {
    return api.get('/admin/errors', { params }).then(r => r.data);
  },
  /** { disponible, motivo?, backups: [{ nombre, tamano, fecha }] } */
  listBackups() {
    return api.get('/admin/backups').then(r => r.data.data);
  },
  /**
   * Descarga un dump con la contraseña del superadmin (el backend la vuelve a
   * pedir, SEC-18). Va por axios (con el token) y no por un <a href>, que no
   * lleva Authorization; el blob se entrega al navegador y se suelta.
   * Si falla, lanza un Error con el mensaje del servidor: con
   * responseType 'blob' el JSON de error llega también como Blob.
   */
  async descargarBackup(nombre, password) {
    let r;
    try {
      r = await api.post(`/admin/backups/${encodeURIComponent(nombre)}/descarga`,
        { password }, { responseType: 'blob' });
    } catch (err) {
      let mensaje = null;
      try { mensaje = JSON.parse(await err.response?.data?.text?.())?.message; } catch { /* no era JSON */ }
      throw Object.assign(new Error(mensaje || 'No se pudo descargar el backup'), { status: err.response?.status });
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
  /** { accessToken, expiraEnMin, user } para ver la app como ese usuario. */
  impersonar(userId) {
    return api.post(`/admin/impersonar/${userId}`).then(r => r.data.data);
  },
};
