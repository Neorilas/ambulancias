'use strict';

const { query, transaction } = require('../../../config/database');

jest.mock('../../../controllers/admin.controller', () => ({
  logAudit: jest.fn(),
  logError: jest.fn(),
}));

const { listUsers, getUser, createUser, updateUser, deleteUser, listRoles, createRole } = require('../../../controllers/users.controller');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

describe('users.controller', () => {
  beforeEach(() => jest.clearAllMocks());

  // ── listUsers ──────────────────────────────────────────
  describe('listUsers', () => {
    it('returns paginated user list', async () => {
      query.mockResolvedValueOnce([[{ total: 2 }]]); // count
      query.mockResolvedValueOnce([[
        { id: 1, username: 'admin', roles: 'administrador' },
        { id: 2, username: 'tec', roles: 'tecnico' },
      ]]);

      const req = mockReq({ query: { page: 1, limit: 10 }, user: { roles: ['administrador'] } });
      const res = mockRes();
      await listUsers(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data).toHaveLength(2);
    });

    it('filters by search', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 1, username: 'admin', roles: 'administrador' }]]);

      const req = mockReq({ query: { search: 'admin' }, user: { roles: ['administrador'] } });
      const res = mockRes();
      await listUsers(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('filters by role', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 2, username: 'tec', roles: 'tecnico' }]]);

      const req = mockReq({ query: { role: 'tecnico' }, user: { roles: ['administrador'] } });
      const res = mockRes();
      await listUsers(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('shows deleted users when admin requests deleted=true', async () => {
      query.mockResolvedValueOnce([[{ total: 1 }]]);
      query.mockResolvedValueOnce([[{ id: 3, username: 'deleted_user__del_3', roles: null, deleted_at: new Date() }]]);

      const req = mockReq({ query: { deleted: 'true' }, user: { roles: ['administrador'] } });
      const res = mockRes();
      await listUsers(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      // WHERE clause should NOT contain deleted_at IS NULL
      const countSql = query.mock.calls[0][0];
      expect(countSql).not.toContain('deleted_at IS NULL');
    });
  });

  // ── getUser ────────────────────────────────────────────
  describe('getUser', () => {
    it('returns user with roles array', async () => {
      query.mockResolvedValueOnce([[{ id: 1, username: 'admin', nombre: 'Admin', apellidos: 'X', roles: 'administrador' }]]);

      const res = mockRes();
      await getUser(mockReq({ params: { id: 1 } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data.roles).toEqual(['administrador']);
    });

    it('returns 404 when not found', async () => {
      query.mockResolvedValueOnce([[]]);
      const res = mockRes();
      await getUser(mockReq({ params: { id: 999 } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── createUser ─────────────────────────────────────────
  describe('createUser', () => {
    it('creates user with roles via transaction', async () => {
      query.mockResolvedValueOnce([[]]);  // no duplicate
      transaction.mockImplementation(async (cb) => {
        const conn = {
          execute: jest.fn()
            .mockResolvedValueOnce([{ insertId: 5 }])    // INSERT user
            .mockResolvedValueOnce([[{ id: 2, nombre: 'tecnico' }]]) // role lookup
            .mockResolvedValueOnce([]),                   // INSERT user_roles
        };
        return cb(conn);
      });
      query.mockResolvedValueOnce([[{ id: 5, username: 'nuevo', nombre: 'Nuevo', apellidos: 'User', email: null, activo: 1, roles: 'tecnico' }]]);

      const req = mockReq({
        body: { username: 'nuevo', password: 'Test1234!', nombre: 'Nuevo', apellidos: 'User', dni: '11111111A', roles: ['tecnico'] },
        user: { id: 1, username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await createUser(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res._json.data.username).toBe('nuevo');
    });

    it('returns 409 for duplicate username/dni', async () => {
      query.mockResolvedValueOnce([[{ id: 3 }]]);  // duplicate exists

      const req = mockReq({
        body: { username: 'dup', password: 'Test1234!', nombre: 'X', apellidos: 'Y', dni: '11111111A' },
        user: { id: 1 },
      });
      const res = mockRes();
      await createUser(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('returns 422 for weak password', async () => {
      const res = mockRes();
      await createUser(mockReq({
        body: { username: 'nuevo', password: 'short', nombre: 'N', apellidos: 'U', dni: '22222222B' },
        user: { id: 1 },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(422);
    });

    it('returns 403 when an administrador tries to create a superadmin', async () => {
      const res = mockRes();
      await createUser(mockReq({
        body: { username: 'nuevo', password: 'Test1234!', nombre: 'N', apellidos: 'U',
                dni: '44444444D', roles: ['superadmin'] },
        user: { id: 1, username: 'admin', roles: ['administrador'] },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
      expect(query).not.toHaveBeenCalled();
    });

    it('creates user without roles (empty roleNames branch)', async () => {
      query.mockResolvedValueOnce([[]]); // no duplicate
      transaction.mockImplementation(async (cb) => {
        const conn = {
          execute: jest.fn()
            .mockResolvedValueOnce([{ insertId: 6 }]), // INSERT user only (no role inserts)
        };
        return cb(conn);
      });
      query.mockResolvedValueOnce([[{ id: 6, username: 'noroles', nombre: 'No', apellidos: 'Roles', email: null, activo: 1, roles: null }]]);

      const req = mockReq({
        body: { username: 'noroles', password: 'Test1234!', nombre: 'No', apellidos: 'Roles', dni: '33333333C', roles: [] },
        user: { id: 1, username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await createUser(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  // ── updateUser ─────────────────────────────────────────
  describe('updateUser', () => {
    it('updates user fields', async () => {
      query.mockResolvedValueOnce([[{ id: 2, activo: 1, roles: 'tecnico' }]]); // existing
      transaction.mockImplementation(async (cb) => {
        const conn = { execute: jest.fn().mockResolvedValue([]) };
        return cb(conn);
      });
      query.mockResolvedValueOnce([[{ id: 2, username: 'tec', email: 'new@a.com', nombre: 'Tec', apellidos: 'U', activo: 1, roles: 'tecnico' }]]);

      const req = mockReq({
        params: { id: '2' },
        body: { email: 'new@a.com' },
        user: { id: 1, roles: ['administrador'], username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await updateUser(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 404 when not found', async () => {
      query.mockResolvedValueOnce([[]]); // not found

      const req = mockReq({ params: { id: '999' }, body: { nombre: 'X' }, user: { id: 1, roles: ['administrador'] } });
      const res = mockRes();
      await updateUser(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 403 when gestor tries to modify an administrador', async () => {
      query.mockResolvedValueOnce([[{ id: 2, activo: 1, roles: 'administrador' }]]); // target is admin

      const req = mockReq({
        params: { id: '2' },
        body: { nombre: 'X' },
        user: { id: 3, roles: ['gestor'], username: 'gestor1' },
      });
      const res = mockRes();
      await updateUser(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 403 when gestor tries to assign administrador role', async () => {
      query.mockResolvedValueOnce([[{ id: 4, activo: 1, roles: 'tecnico' }]]); // target is tecnico

      const req = mockReq({
        params: { id: '4' },
        body: { roles: ['administrador'] },
        user: { id: 3, roles: ['gestor'], username: 'gestor1' },
      });
      const res = mockRes();
      await updateUser(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns 403 when gestor tries to assign superadmin role (SEC-01)', async () => {
      query.mockResolvedValueOnce([[{ id: 4, activo: 1, roles: 'gestor' }]]);

      const req = mockReq({
        params: { id: '4' },
        body: { roles: ['gestor', 'superadmin'] },
        user: { id: 4, roles: ['gestor'], username: 'gestor1' },
      });
      const res = mockRes();
      await updateUser(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('returns 403 when an administrador tries to assign superadmin role', async () => {
      query.mockResolvedValueOnce([[{ id: 2, activo: 1, roles: 'tecnico' }]]);

      const req = mockReq({
        params: { id: '2' },
        body: { roles: ['superadmin'] },
        user: { id: 1, roles: ['administrador'], username: 'admin' },
      });
      const res = mockRes();
      await updateUser(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('returns 403 when a non-superadmin tries to modify a superadmin', async () => {
      query.mockResolvedValueOnce([[{ id: 9, activo: 1, roles: 'administrador,superadmin' }]]);

      const req = mockReq({
        params: { id: '9' },
        body: { nombre: 'Secuestrado' },
        user: { id: 1, roles: ['administrador'], username: 'admin' },
      });
      const res = mockRes();
      await updateUser(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('lets a superadmin assign the superadmin role', async () => {
      query.mockResolvedValueOnce([[{ id: 2, activo: 1, roles: 'tecnico' }]]);
      transaction.mockImplementation(async (cb) => cb({
        execute: jest.fn()
          .mockResolvedValueOnce([])                                  // DELETE user_roles
          .mockResolvedValueOnce([[{ id: 1, nombre: 'superadmin' }]]) // SELECT roles
          .mockResolvedValueOnce([]),                                 // INSERT user_roles
      }));
      query.mockResolvedValueOnce([[{ id: 2, username: 'tec', email: null, nombre: 'Tec', apellidos: 'U', activo: 1, roles: 'superadmin' }]]);

      const req = mockReq({
        params: { id: '2' },
        body: { roles: ['superadmin'] },
        user: { id: 1, roles: ['superadmin'], username: 'root' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await updateUser(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('rejects a role that does not exist in the catalogue', async () => {
      query.mockResolvedValueOnce([[{ id: 2, activo: 1, roles: 'tecnico' }]]);
      transaction.mockImplementation(async (cb) => cb({
        execute: jest.fn()
          .mockResolvedValueOnce([])      // DELETE user_roles
          .mockResolvedValueOnce([[]]),   // SELECT roles → el rol no existe
      }));

      const req = mockReq({
        params: { id: '2' },
        body: { roles: ['rol_inventado'] },
        user: { id: 1, roles: ['administrador'], username: 'admin' },
      });
      const res = mockRes();
      const next = mockNext();
      await updateUser(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ type: 'validation' }));
    });

    it('updates user password (admin caller)', async () => {
      query.mockResolvedValueOnce([[{ id: 2, activo: 1, roles: 'tecnico' }]]);
      transaction.mockImplementation(async (cb) => {
        const conn = { execute: jest.fn().mockResolvedValue([]) };
        return cb(conn);
      });
      query.mockResolvedValueOnce([[{ id: 2, username: 'tec', email: null, nombre: 'Tec', apellidos: 'U', activo: 1, roles: 'tecnico' }]]);

      const req = mockReq({
        params: { id: '2' },
        body: { password: 'NewPass123!' },
        user: { id: 1, roles: ['administrador'], username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await updateUser(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('throws validation error for weak password (admin caller)', async () => {
      query.mockResolvedValueOnce([[{ id: 2, activo: 1, roles: 'tecnico' }]]);
      transaction.mockImplementation(async (cb) => {
        const conn = { execute: jest.fn().mockResolvedValue([]) };
        // Simulate the transaction calling the callback which throws validation error
        return cb(conn);
      });

      const req = mockReq({
        params: { id: '2' },
        body: { password: 'x' }, // weak password
        user: { id: 1, roles: ['administrador'], username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      const next = mockNext();
      await updateUser(req, res, next);
      // Should call next with error (validation) or return 422
      // The transaction throws, so next is called with an error
      expect(next).toHaveBeenCalled();
    });

    it('updates user with roles (covers role reassignment branch)', async () => {
      query.mockResolvedValueOnce([[{ id: 2, activo: 1, roles: 'tecnico' }]]);
      transaction.mockImplementation(async (cb) => {
        const executeMock = jest.fn();
        // Call 1: DELETE user_roles → []
        // Call 2: SELECT roles → [[{id:3}]]
        // Call 3: INSERT user_roles → []
        executeMock
          .mockResolvedValueOnce([])                        // DELETE user_roles
          .mockResolvedValueOnce([[{ id: 3, nombre: 'enfermero' }]]) // SELECT roles
          .mockResolvedValueOnce([]);                       // INSERT user_roles
        const conn = { execute: executeMock };
        return cb(conn);
      });
      query.mockResolvedValueOnce([[{ id: 2, username: 'tec', email: null, nombre: 'Tec', apellidos: 'U', activo: 1, roles: 'enfermero' }]]);

      const req = mockReq({
        params: { id: '2' },
        body: { roles: ['enfermero'] },
        user: { id: 1, roles: ['administrador'], username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await updateUser(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('updates user activo field (admin caller)', async () => {
      query.mockResolvedValueOnce([[{ id: 2, activo: 1, roles: 'tecnico' }]]);
      transaction.mockImplementation(async (cb) => {
        const conn = { execute: jest.fn().mockResolvedValue([]) };
        return cb(conn);
      });
      query.mockResolvedValueOnce([[{ id: 2, username: 'tec', email: null, nombre: 'Tec', apellidos: 'U', activo: 0, roles: 'tecnico' }]]);

      const req = mockReq({
        params: { id: '2' },
        body: { activo: false },
        user: { id: 1, roles: ['administrador'], username: 'admin' },
        ip: '1.1.1.1',
      });
      const res = mockRes();
      await updateUser(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  // ── deleteUser ─────────────────────────────────────────
  describe('deleteUser', () => {
    it('soft deletes user', async () => {
      query.mockResolvedValueOnce([[{ id: 2 }]]); // exists
      transaction.mockImplementation(async (cb) => {
        const conn = { execute: jest.fn().mockResolvedValue([]) };
        return cb(conn);
      });

      const req = mockReq({ params: { id: '2' }, user: { id: 1, username: 'admin' }, ip: '1.1.1.1' });
      const res = mockRes();
      await deleteUser(req, res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 403 when a non-superadmin deletes a superadmin', async () => {
      query.mockResolvedValueOnce([[{ id: 9, roles: 'superadmin' }]]);

      const res = mockRes();
      await deleteUser(mockReq({
        params: { id: '9' },
        user: { id: 1, roles: ['administrador'], username: 'admin' },
      }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
      expect(transaction).not.toHaveBeenCalled();
    });

    it('returns 400 for self-deletion', async () => {
      const res = mockRes();
      await deleteUser(mockReq({ params: { id: '1' }, user: { id: 1 } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns 404 when not found', async () => {
      query.mockResolvedValueOnce([[]]); // not found
      const res = mockRes();
      await deleteUser(mockReq({ params: { id: '999' }, user: { id: 1 } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  // ── listRoles ──────────────────────────────────────────
  describe('listRoles', () => {
    it('returns all roles', async () => {
      query.mockResolvedValueOnce([[
        { id: 1, nombre: 'administrador', descripcion: 'Admin' },
        { id: 2, nombre: 'tecnico', descripcion: 'Técnico' },
      ]]);

      const res = mockRes();
      await listRoles(mockReq(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res._json.data).toHaveLength(2);
    });
  });

  // ── createRole ─────────────────────────────────────────
  describe('createRole', () => {
    it('creates a new role', async () => {
      query.mockResolvedValueOnce([[]]); // no duplicate
      query.mockResolvedValueOnce([{ insertId: 10 }]); // insert

      const res = mockRes();
      await createRole(mockReq({ body: { nombre: 'conductor', descripcion: 'Conductor' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('returns 409 for duplicate role', async () => {
      query.mockResolvedValueOnce([[{ id: 1 }]]); // exists
      const res = mockRes();
      await createRole(mockReq({ body: { nombre: 'tecnico' } }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(409);
    });
  });
});
