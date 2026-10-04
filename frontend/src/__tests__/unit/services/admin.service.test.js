import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminService } from '../../../services/admin.service';
import api from '../../../services/api';

vi.mock('../../../services/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('admin.service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getStats calls GET /admin/stats', async () => {
    api.get.mockResolvedValueOnce({ data: { data: {} } });
    await adminService.getStats();
    expect(api.get).toHaveBeenCalledWith('/admin/stats');
  });

  it('listAudit calls GET /admin/audit', async () => {
    api.get.mockResolvedValueOnce({ data: { data: [] } });
    await adminService.listAudit({ page: 1 });
    expect(api.get).toHaveBeenCalledWith('/admin/audit', { params: { page: 1 } });
  });

  describe('descargarBackup (pide la contraseña, SEC-18)', () => {
    it('manda la contraseña por POST y entrega el blob al navegador', async () => {
      const blob = new Blob(['DUMP']);
      api.post.mockResolvedValueOnce({ data: blob });
      URL.createObjectURL = vi.fn(() => 'blob:x');
      URL.revokeObjectURL = vi.fn();
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      await adminService.descargarBackup('amb_20260926_034500.sql.gz', 'secreta');

      expect(api.post).toHaveBeenCalledWith(
        '/admin/backups/amb_20260926_034500.sql.gz/descarga',
        { password: 'secreta' },
        { responseType: 'blob' },
      );
      expect(click).toHaveBeenCalled();
      click.mockRestore();
    });

    it('con un error, saca el mensaje del JSON que llega como Blob y conserva el status', async () => {
      const cuerpo = new Blob([JSON.stringify({ success: false, message: 'Contraseña incorrecta' })]);
      api.post.mockRejectedValueOnce({ response: { status: 403, data: cuerpo } });

      await expect(adminService.descargarBackup('x.sql.gz', 'mala'))
        .rejects.toMatchObject({ message: 'Contraseña incorrecta', status: 403 });
    });

    it('sin respuesta legible, mensaje genérico', async () => {
      api.post.mockRejectedValueOnce(new Error('Network Error'));
      await expect(adminService.descargarBackup('x.sql.gz', 'p'))
        .rejects.toMatchObject({ message: 'No se pudo descargar el backup' });
    });
  });

  it('listErrors calls GET /admin/errors', async () => {
    api.get.mockResolvedValueOnce({ data: { data: [] } });
    await adminService.listErrors();
    expect(api.get).toHaveBeenCalledWith('/admin/errors', { params: {} });
  });
});
