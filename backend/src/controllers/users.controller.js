/**
 * controllers/users.controller.js
 * CRUD de usuarios + gestión de roles
 */

'use strict';

const { query, transaction }          = require('../config/database');
const { hashPassword, validatePasswordStrength } = require('../utils/password.utils');
const { success, created, error, notFound, forbidden, paginated, validationError } =
  require('../utils/response.utils');
const { ROLES, PAGINATION }           = require('../config/constants');
const { isAdmin }                     = require('../middleware/roles.middleware');

// ============================================================
// GET /users
// ============================================================
async function listUsers(req, res, next) {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || PAGINATION.DEFAULT_PAGE);
    const limit = Math.min(
      parseInt(req.query.limit) || PAGINATION.DEFAULT_LIMIT,
      PAGINATION.MAX_LIMIT
    );
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;
    const roleFilter = req.query.role || null;
    const showDeleted = isAdmin(req.user) && req.query.deleted === 'true';

    let whereClauses = showDeleted ? [] : ['u.deleted_at IS NULL'];
    const params = [];

    if (search) {
      whereClauses.push('(u.username LIKE ? OR u.nombre LIKE ? OR u.apellidos LIKE ? OR u.email LIKE ?)');
      params.push(search, search, search, search);
    }

    if (roleFilter) {
      whereClauses.push('EXISTS (SELECT 1 FROM user_roles ur2 JOIN roles r2 ON ur2.role_id = r2.id WHERE ur2.user_id = u.id AND r2.nombre = ?)');
      params.push(roleFilter);
    }

    const where = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const [countRows] = await query(
      `SELECT COUNT(DISTINCT u.id) AS total FROM users u ${where}`,
      params
    );
    const total = countRows[0].total;

    const [rows] = await query(
      `SELECT u.id, u.username, u.email, u.nombre, u.apellidos, u.dni,
              u.telefono, u.activo, u.created_at, u.updated_at, u.deleted_at,
              GROUP_CONCAT(r.nombre ORDER BY r.nombre SEPARATOR ',') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       LEFT JOIN roles r ON ur.role_id = r.id
       ${where}
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const data = rows.map(u => ({
      ...u,
      roles: u.roles ? u.roles.split(',') : [],
    }));

    return paginated(res, { data, total, page, limit });
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /users/:id
// ============================================================
async function getUser(req, res, next) {
  try {
    const [rows] = await query(
      `SELECT u.id, u.username, u.email, u.nombre, u.apellidos, u.dni,
              u.direccion, u.telefono, u.activo, u.created_at, u.updated_at,
              GROUP_CONCAT(r.nombre ORDER BY r.nombre SEPARATOR ',') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       LEFT JOIN roles r ON ur.role_id = r.id
       WHERE u.id = ? AND u.deleted_at IS NULL
       GROUP BY u.id`,
      [req.params.id]
    );

    if (!rows.length) return notFound(res, 'Usuario');

    const user = { ...rows[0], roles: rows[0].roles ? rows[0].roles.split(',') : [] };
    return success(res, user);
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /users
// Solo administrador
// ============================================================
async function createUser(req, res, next) {
  try {
    const { username, password, email, nombre, apellidos, dni,
            direccion, telefono, roles: roleNames = [] } = req.body;

    // Validar fortaleza de contraseña
    const { valid, errors: pwErrors } = validatePasswordStrength(password);
    if (!valid) return validationError(res, pwErrors.map(e => ({ field: 'password', message: e })));

    // Verificar username único
    const [existing] = await query(
      'SELECT id FROM users WHERE (username = ? OR dni = ?) AND deleted_at IS NULL',
      [username, dni]
    );
    if (existing.length) return error(res, 'Username o DNI ya en uso', 409);

    const passwordHash = await hashPassword(password);

    const userId = await transaction(async (conn) => {
      const [result] = await conn.execute(
        `INSERT INTO users (username, password_hash, email, nombre, apellidos, dni, direccion, telefono)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [username, passwordHash, email || null, nombre, apellidos, dni,
         direccion || null, telefono || null]
      );
      const newId = result.insertId;

      // Asignar roles si se proporcionaron
      if (roleNames.length > 0) {
        const [roleRows] = await conn.execute(
          `SELECT id, nombre FROM roles WHERE nombre IN (${roleNames.map(() => '?').join(',')})`,
          roleNames
        );
        for (const role of roleRows) {
          await conn.execute(
            'INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)',
            [newId, role.id, req.user.id]
          );
        }
      }

      return newId;
    });

    const [newUser] = await query(
      `SELECT u.id, u.username, u.nombre, u.apellidos, u.email, u.activo,
              GROUP_CONCAT(r.nombre SEPARATOR ',') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       LEFT JOIN roles r ON ur.role_id = r.id
       WHERE u.id = ?
       GROUP BY u.id`,
      [userId]
    );

    return created(res, {
      ...newUser[0],
      roles: newUser[0].roles ? newUser[0].roles.split(',') : [],
    }, 'Usuario creado correctamente');

  } catch (err) {
    next(err);
  }
}

// ============================================================
// PUT /users/:id
// Administrador: todo | Gestor: sin asignar rol admin
// ============================================================
async function updateUser(req, res, next) {
  try {
    const targetId = parseInt(req.params.id);
    const caller   = req.user;

    const [existing] = await query(
      `SELECT u.id, u.activo, GROUP_CONCAT(r.nombre SEPARATOR ',') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       LEFT JOIN roles r ON ur.role_id = r.id
       WHERE u.id = ? AND u.deleted_at IS NULL
       GROUP BY u.id`,
      [targetId]
    );
    if (!existing.length) return notFound(res, 'Usuario');

    const targetRoles = existing[0].roles ? existing[0].roles.split(',') : [];
    const isGestor    = caller.roles.includes(ROLES.GESTOR) && !isAdmin(caller);

    // Gestor no puede modificar a un administrador
    if (isGestor && targetRoles.includes(ROLES.ADMINISTRADOR)) {
      return forbidden(res, 'No tienes permiso para modificar un administrador');
    }

    const { email, nombre, apellidos, dni, direccion, telefono, activo,
            roles: newRoles, password } = req.body;

    // Gestor no puede asignar rol administrador
    if (isGestor && newRoles?.includes(ROLES.ADMINISTRADOR)) {
      return forbidden(res, 'No tienes permiso para asignar el rol de administrador');
    }

    await transaction(async (conn) => {
      // Actualizar campos básicos (solo los que lleguen)
      const updates = [];
      const vals    = [];
      if (email     !== undefined) { updates.push('email = ?');     vals.push(email || null); }
      if (nombre    !== undefined) { updates.push('nombre = ?');    vals.push(nombre); }
      if (apellidos !== undefined) { updates.push('apellidos = ?'); vals.push(apellidos); }
      if (dni       !== undefined) { updates.push('dni = ?');       vals.push(dni); }
      if (direccion !== undefined) { updates.push('direccion = ?'); vals.push(direccion || null); }
      if (telefono  !== undefined) { updates.push('telefono = ?');  vals.push(telefono || null); }
      if (activo    !== undefined && isAdmin(caller)) {
        updates.push('activo = ?'); vals.push(activo ? 1 : 0);
      }

      if (password !== undefined && isAdmin(caller)) {
        const { valid, errors: pwErrors } = validatePasswordStrength(password);
        if (!valid) throw Object.assign(new Error('Password débil'), { type: 'validation', errors: pwErrors });
        updates.push('password_hash = ?');
        vals.push(await hashPassword(password));
      }

      if (updates.length) {
        await conn.execute(
          `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
          [...vals, targetId]
        );
      }

      // Actualizar roles si llegan (solo admin o gestor)
      if (newRoles !== undefined) {
        // Borrar roles actuales
        await conn.execute('DELETE FROM user_roles WHERE user_id = ?', [targetId]);
        if (newRoles.length > 0) {
          const [roleRows] = await conn.execute(
            `SELECT id FROM roles WHERE nombre IN (${newRoles.map(() => '?').join(',')})`,
            newRoles
          );
          for (const role of roleRows) {
            await conn.execute(
              'INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)',
              [targetId, role.id, caller.id]
            );
          }
        }
      }
    });

    const [updated] = await query(
      `SELECT u.id, u.username, u.email, u.nombre, u.apellidos, u.activo,
              GROUP_CONCAT(r.nombre SEPARATOR ',') AS roles
       FROM users u
       LEFT JOIN user_roles ur ON u.id = ur.user_id
       LEFT JOIN roles r ON ur.role_id = r.id
       WHERE u.id = ?
       GROUP BY u.id`,
      [targetId]
    );

    return success(res, {
      ...updated[0],
      roles: updated[0].roles ? updated[0].roles.split(',') : [],
    }, 'Usuario actualizado');

  } catch (err) {
    next(err);
  }
}

// ============================================================
// DELETE /users/:id  (soft delete - solo admin)
// ============================================================
async function deleteUser(req, res, next) {
  try {
    const targetId = parseInt(req.params.id);

    // No puede borrarse a sí mismo
    if (targetId === req.user.id) {
      return error(res, 'No puedes eliminar tu propia cuenta', 400);
    }

    const [existing] = await query(
      'SELECT id FROM users WHERE id = ? AND deleted_at IS NULL', [targetId]
    );
    if (!existing.length) return notFound(res, 'Usuario');

    await transaction(async (conn) => {
      // Soft delete
      await conn.execute(
        'UPDATE users SET deleted_at = NOW(), activo = 0 WHERE id = ?',
        [targetId]
      );
      // Revocar tokens activos
      await conn.execute(
        'UPDATE refresh_tokens SET revoked = 1, revoked_at = NOW() WHERE user_id = ? AND revoked = 0',
        [targetId]
      );
    });

    return success(res, null, 'Usuario eliminado (soft delete)');
  } catch (err) {
    next(err);
  }
}

// ============================================================
// GET /users/roles  - listar roles disponibles
// ============================================================
async function listRoles(req, res, next) {
  try {
    const [rows] = await query('SELECT id, nombre, descripcion FROM roles ORDER BY nombre');
    return success(res, rows);
  } catch (err) {
    next(err);
  }
}

// ============================================================
// POST /users/roles  - crear nuevo rol (solo admin)
// ============================================================
async function createRole(req, res, next) {
  try {
    const { nombre, descripcion } = req.body;

    const [existing] = await query('SELECT id FROM roles WHERE nombre = ?', [nombre]);
    if (existing.length) return error(res, 'Ya existe un rol con ese nombre', 409);

    const [result] = await query(
      'INSERT INTO roles (nombre, descripcion) VALUES (?, ?)',
      [nombre, descripcion || null]
    );

    return created(res, { id: result.insertId, nombre, descripcion }, 'Rol creado');
  } catch (err) {
    next(err);
  }
}

module.exports = { listUsers, getUser, createUser, updateUser, deleteUser, listRoles, createRole };
