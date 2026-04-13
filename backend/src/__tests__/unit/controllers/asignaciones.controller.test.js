'use strict';

const { query } = require('../../../config/database');

jest.mock('../../../controllers/admin.controller', () => ({
  logAudit: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../../../middleware/upload.middleware', () => ({
  processAndSave: jest.fn(),
  deleteFile: jest.fn(),
}));

const {
  listAsignaciones, getAsignacion, createAsignacion, updateAsignacion,
  deleteAsignacion, activarAsignacion, finalizarAsignacion, uploadEvidencia,
} = require('../../../controllers/asignaciones.controller');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');
const { IMAGEN_TIPOS_REQUERIDOS } = require('../../../config/constants');

// Helper: mock getAsignacionCompleta (main + evidencias + getProgreso)
function mockAsignacionCompleta(overrides = {}) {
  const base = {
    id: 1, vehicle_id: 1, user_id: 2, estado: 'activa',
    fecha_inicio: new Date(), fecha_fin: new Date(Date.now() + 86400000),
    km_inicio: 10000, km_fin: null,
    matricula: 'ABC1234', vehiculo_alias: 'AMB-1',
    responsable_nombre: 'Tec User', responsable_username: 'tec',
    creado_por_nombre: 'Admin U',
    ...overrides,
  };
  query.mockResolvedValueOnce([[base]]); // main query
  query.mockResolvedValueOnce([[]]);     // evidencias
  query.mockResolvedValueOnce([[]]);     // getProgreso
}

describe('asignaciones.controller', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── listAsignaciones ───────────────────────────────────
  describe('listAsignaciones', () => {
    it('returns paginated list', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{
        id: 1, estado: 'activa', matricula: 'ABC1234',
        responsable_nombre: 'Tec User',
      }]]);

      const req = mockReq({
        query: {}, user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      });
      const res = mockRes();
      await listAsignaciones(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data).toHaveLength(1);
    });

    it('adds user_id filter for operacional (no manage_trabajos permission)', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 1, estado: 'activa', matricula: 'ABC1234', responsable_nombre: 'Tec' }]]);

      const req = mockReq({
        query: {},
        user: { id: 5, roles: ['tecnico'], permissions: [] },
      });
      const res = mockRes();
      await listAsignaciones(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      // user_id=5 should be in the query params
      expect(query.mock.calls[0][1]).toContain(5);
    });

    it('applies estado filter when provided', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 1, estado: 'activa', matricula: 'ABC1234', responsable_nombre: 'Tec' }]]);

      const req = mockReq({
        query: { estado: 'activa' },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      });
      const res = mockRes();
      await listAsignaciones(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(query.mock.calls[0][1]).toContain('activa');
    });
  });

  // ── getAsignacion ──────────────────────────────────────
  describe('getAsignacion', () => {
    it('returns asignacion completa', async () => {
      mockAsignacionCompleta();

      const req = mockReq({ params: { id: '1' }, user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] } });
      const res = mockRes();
      await getAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 404 when not found', async () => {
      query.mockResolvedValueOnce([[]]); // getAsignacionCompleta returns null
      const res = mockRes();
      await getAsignacion(mockReq({ params: { id: '999' }, user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 for operacional accessing another user asignacion', async () => {
      // asig.user_id = 2, req.user.id = 5, no manage permission
      mockAsignacionCompleta({ user_id: 2 });

      const req = mockReq({
        params: { id: '1' },
        user: { id: 5, roles: ['tecnico'], permissions: [] },
      });
      const res = mockRes();
      await getAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ── createAsignacion ───────────────────────────────────
  describe('createAsignacion', () => {
    it('creates asignacion', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle exists
      query.mockResolvedValueOnce([[{ id: 2, activo: 1 }]]); // user exists
      query.mockResolvedValueOnce([{ insertId: 5 }]); // insert
      mockAsignacionCompleta({ id: 5 }); // getAsignacionCompleta

      const req = mockReq({
        body: { vehicle_id: 1, user_id: 2, fecha_inicio: '2026-04-15T08:00', fecha_fin: '2026-04-15T20:00' },
        user: { id: 1 },
      });
      const res = mockRes();
      await createAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('returns 404 for missing vehicle', async () => {
      query.mockResolvedValueOnce([[]]); // not found
      const res = mockRes();
      await createAsignacion(mockReq({
        body: { vehicle_id: 999, user_id: 2, fecha_inicio: '2026-04-15T08:00', fecha_fin: '2026-04-15T20:00' },
        user: { id: 1 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 404 when user not found', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle found
      query.mockResolvedValueOnce([[]]); // user not found
      const res = mockRes();
      await createAsignacion(mockReq({
        body: { vehicle_id: 1, user_id: 999, fecha_inicio: '2026-04-15T08:00', fecha_fin: '2026-04-15T20:00' },
        user: { id: 1 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 when fecha_fin <= fecha_inicio', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // vehicle found
      query.mockResolvedValueOnce([[{ id: 2, activo: 1 }]]); // user found
      const res = mockRes();
      await createAsignacion(mockReq({
        body: { vehicle_id: 1, user_id: 2, fecha_inicio: '2026-04-15T20:00', fecha_fin: '2026-04-15T08:00' },
        user: { id: 1 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── updateAsignacion ───────────────────────────────────
  describe('updateAsignacion', () => {
    it('updates asignacion fields', async () => {
      mockAsignacionCompleta({ estado: 'programada' }); // fetch existing
      query.mockResolvedValueOnce([]); // UPDATE
      mockAsignacionCompleta({ estado: 'programada' }); // fetch updated

      const req = mockReq({
        params: { id: '1' },
        body: { notas: 'Updated' },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      });
      const res = mockRes();
      await updateAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 400 for finalizada', async () => {
      mockAsignacionCompleta({ estado: 'finalizada' });
      const res = mockRes();
      await updateAsignacion(mockReq({
        params: { id: '1' }, body: { notas: 'X' },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when asignacion not found', async () => {
      query.mockResolvedValueOnce([[]]); // getAsignacionCompleta returns null
      const res = mockRes();
      await updateAsignacion(mockReq({
        params: { id: '999' }, body: { notas: 'X' },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 400 for cancelada asignacion', async () => {
      mockAsignacionCompleta({ estado: 'cancelada' });
      const res = mockRes();
      await updateAsignacion(mockReq({
        params: { id: '1' }, body: { notas: 'X' },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 for invalid estado (finalizada via update)', async () => {
      mockAsignacionCompleta({ estado: 'activa' });
      const res = mockRes();
      await updateAsignacion(mockReq({
        params: { id: '1' }, body: { estado: 'finalizada' },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('validates vehicle_id change', async () => {
      mockAsignacionCompleta({ estado: 'activa' });
      query.mockResolvedValueOnce([[{ id: 2 }]]); // vehicle found
      query.mockResolvedValueOnce([]); // UPDATE
      mockAsignacionCompleta({ estado: 'activa' });

      const req = mockReq({
        params: { id: '1' },
        body: { vehicle_id: 2 },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      });
      const res = mockRes();
      await updateAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('validates user_id change', async () => {
      mockAsignacionCompleta({ estado: 'activa' });
      query.mockResolvedValueOnce([[{ id: 3, activo: 1 }]]); // user found
      query.mockResolvedValueOnce([]); // UPDATE
      mockAsignacionCompleta({ estado: 'activa' });

      const req = mockReq({
        params: { id: '1' },
        body: { user_id: 3 },
        user: { id: 1, roles: ['administrador'], permissions: ['manage_trabajos'] },
      });
      const res = mockRes();
      await updateAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ── deleteAsignacion ───────────────────────────────────
  describe('deleteAsignacion', () => {
    it('soft deletes', async () => {
      query.mockResolvedValueOnce([[{ id: 1, estado: 'programada' }]]);
      query.mockResolvedValueOnce([]); // UPDATE

      const res = mockRes();
      await deleteAsignacion(mockReq({ params: { id: '1' }, user: { id: 1 } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 404 when not found', async () => {
      query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      await deleteAsignacion(mockReq({ params: { id: '999' }, user: { id: 1 } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── activarAsignacion ──────────────────────────────────
  describe('activarAsignacion', () => {
    it('activates programada asignacion', async () => {
      mockAsignacionCompleta({ estado: 'programada' });
      query.mockResolvedValueOnce([]); // UPDATE
      mockAsignacionCompleta({ estado: 'activa' });

      const req = mockReq({ params: { id: '1' }, user: { id: 2, roles: ['tecnico'], permissions: [] } });
      const res = mockRes();
      await activarAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 400 for non-programada', async () => {
      mockAsignacionCompleta({ estado: 'activa' });
      const res = mockRes();
      await activarAsignacion(mockReq({ params: { id: '1' }, user: { id: 2, roles: ['tecnico'], permissions: [] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when asignacion not found', async () => {
      query.mockResolvedValueOnce([[]]); // not found
      const res = mockRes();
      await activarAsignacion(mockReq({ params: { id: '999' }, user: { id: 2, roles: ['tecnico'], permissions: [] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 for operacional accessing another user asignacion', async () => {
      // asig.user_id = 2, req.user.id = 99, no manage_trabajos
      mockAsignacionCompleta({ estado: 'programada', user_id: 2 });
      const res = mockRes();
      await activarAsignacion(mockReq({ params: { id: '1' }, user: { id: 99, roles: ['tecnico'], permissions: [] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  // ── finalizarAsignacion ────────────────────────────────
  describe('finalizarAsignacion', () => {
    it('finalizes with complete evidence', async () => {
      // getAsignacionCompleta (past fecha_fin)
      mockAsignacionCompleta({ estado: 'activa', fecha_fin: new Date(Date.now() - 3600000) });
      // getProgreso (called inside finalizarAsignacion)
      const allTipos = IMAGEN_TIPOS_REQUERIDOS.map(t => ({ tipo_imagen: t }));
      query.mockResolvedValueOnce([allTipos]);
      query.mockResolvedValueOnce([]); // UPDATE
      mockAsignacionCompleta({ estado: 'finalizada' });

      const req = mockReq({
        params: { id: '1' }, body: { km_fin: 50100 },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      });
      const res = mockRes();
      await finalizarAsignacion(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 400 for already finalizada', async () => {
      mockAsignacionCompleta({ estado: 'finalizada' });
      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { km_fin: 50100 },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when asignacion not found', async () => {
      query.mockResolvedValueOnce([[]]); // not found
      const res = mockRes();
      await finalizarAsignacion(mockReq({ params: { id: '999' }, body: { km_fin: 50000 }, user: { id: 2, roles: ['tecnico'], permissions: [] } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 for operacional accessing another user asignacion', async () => {
      // asig.user_id = 2, req.user.id = 99, no manage_trabajos
      mockAsignacionCompleta({ estado: 'activa', user_id: 2 });
      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { km_fin: 50000 },
        user: { id: 99, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 400 for cancelada asignacion', async () => {
      mockAsignacionCompleta({ estado: 'cancelada', user_id: 2 });
      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { km_fin: 50000 },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 for anticipada finalization without motivo', async () => {
      // fecha_fin is in the future → anticipada
      mockAsignacionCompleta({ estado: 'activa', user_id: 2, fecha_fin: new Date(Date.now() + 86400000) });
      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { km_fin: 50100 }, // no motivo_fin
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when km_fin < km_inicio', async () => {
      mockAsignacionCompleta({ estado: 'activa', user_id: 2, km_inicio: 50000, fecha_fin: new Date(Date.now() - 3600000) });
      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { km_fin: 49000 }, // less than km_inicio
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 400 when evidence not complete', async () => {
      // fecha_fin past
      mockAsignacionCompleta({ estado: 'activa', user_id: 2, km_inicio: 10000, fecha_fin: new Date(Date.now() - 3600000) });
      // getProgreso returns incomplete (no images uploaded)
      query.mockResolvedValueOnce([[]]); // empty getProgreso
      const res = mockRes();
      await finalizarAsignacion(mockReq({
        params: { id: '1' }, body: { km_fin: 50100 },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // ── uploadEvidencia ────────────────────────────────────
  describe('uploadEvidencia', () => {
    it('uploads evidence (new image)', async () => {
      mockAsignacionCompleta({ estado: 'activa' });
      query.mockResolvedValueOnce([[]]); // no existing image
      query.mockResolvedValueOnce([{ insertId: 50 }]); // INSERT
      query.mockResolvedValueOnce([allTiposRow()]); // getProgreso

      const req = mockReq({
        params: { id: '1' }, body: { tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/img.jpg' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      });
      const res = mockRes();
      await uploadEvidencia(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 400 when no file', async () => {
      mockAsignacionCompleta({ estado: 'activa' });
      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '1' }, body: { tipo_imagen: 'frontal' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when asignacion not found', async () => {
      query.mockResolvedValueOnce([[]]); // not found
      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '999' }, body: { tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/img.jpg' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 for operacional accessing another user asignacion', async () => {
      mockAsignacionCompleta({ estado: 'activa', user_id: 2 });
      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '1' }, body: { tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/img.jpg' },
        user: { id: 99, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 400 when asignacion already finalizada', async () => {
      mockAsignacionCompleta({ estado: 'finalizada', user_id: 2 });
      const res = mockRes();
      await uploadEvidencia(mockReq({
        params: { id: '1' }, body: { tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/img.jpg' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('overwrites existing image (UPDATE path + deleteFile called)', async () => {
      const { deleteFile } = require('../../../middleware/upload.middleware');

      mockAsignacionCompleta({ estado: 'activa', user_id: 2 });
      // existing image found
      query.mockResolvedValueOnce([[{ id: 50, image_url: '/uploads/old.jpg' }]]);
      query.mockResolvedValueOnce([]); // UPDATE
      // getProgreso
      query.mockResolvedValueOnce([IMAGEN_TIPOS_REQUERIDOS.map(t => ({ tipo_imagen: t }))]);

      const req = mockReq({
        params: { id: '1' }, body: { tipo_imagen: 'frontal' },
        processedFile: { url: '/uploads/new.jpg' },
        user: { id: 2, roles: ['tecnico'], permissions: [] },
      });
      const res = mockRes();
      await uploadEvidencia(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(deleteFile).toHaveBeenCalledWith('/uploads/old.jpg');
    });
  });
});

function allTiposRow() {
  return [{ tipo_imagen: 'frontal' }];
}
