'use strict';

const { generateAccessToken } = require('../../utils/jwt.utils');

const adminUser = {
  id: 1,
  username: 'admin',
  nombre: 'Admin',
  apellidos: 'Test',
  roles: ['superadmin', 'administrador'],
  permissions: ['manage_vehicles', 'manage_users', 'manage_trabajos', 'view_all_trabajos', 'manage_incidencias', 'access_admin'],
};

const gestorUser = {
  id: 2,
  username: 'gestor',
  nombre: 'Gestor',
  apellidos: 'Test',
  roles: ['gestor'],
  permissions: ['manage_vehicles', 'manage_trabajos', 'view_all_trabajos', 'manage_incidencias'],
};

const tecnicoUser = {
  id: 3,
  username: 'tecnico',
  nombre: 'Tecnico',
  apellidos: 'Test',
  roles: ['tecnico'],
  permissions: [],
};

function tokenFor(user) {
  return generateAccessToken({
    sub: user.id,
    username: user.username,
    roles: user.roles,
    permissions: user.permissions,
  });
}

module.exports = { adminUser, gestorUser, tecnicoUser, tokenFor };
