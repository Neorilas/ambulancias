import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminService } from '../../../services/admin.service';
import api from '../../../services/api';

vi.mock('../../../services/api', () => ({
  default: {
    get: vi.fn(),
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

  it('listErrors calls GET /admin/errors', async () => {
    api.get.mockResolvedValueOnce({ data: { data: [] } });
    await adminService.listErrors();
    expect(api.get).toHaveBeenCalledWith('/admin/errors', { params: {} });
  });
});
