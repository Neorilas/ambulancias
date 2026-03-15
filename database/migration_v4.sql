-- ============================================================
-- MIGRACIÓN v4: Sistema de permisos granular
-- ============================================================
-- Ejecutar sobre la BD existente (no destruye tablas actuales)
-- ============================================================

-- ── Tabla de permisos disponibles ────────────────────────────
CREATE TABLE IF NOT EXISTS `permissions` (
  `id`          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `nombre`      VARCHAR(100)  NOT NULL,
  `descripcion` VARCHAR(255)  NULL DEFAULT NULL,
  `created_at`  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_perm_nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Permisos granulares del sistema';

-- ── Tabla de asignación rol → permisos ───────────────────────
CREATE TABLE IF NOT EXISTS `role_permissions` (
  `role_id`       INT UNSIGNED NOT NULL,
  `permission_id` INT UNSIGNED NOT NULL,

  PRIMARY KEY (`role_id`, `permission_id`),
  CONSTRAINT `fk_rp_role`       FOREIGN KEY (`role_id`)       REFERENCES `roles`(`id`)       ON DELETE CASCADE,
  CONSTRAINT `fk_rp_permission` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Asignación de permisos a roles (N:M)';

-- ── Insertar permisos base ────────────────────────────────────
INSERT IGNORE INTO `permissions` (`nombre`, `descripcion`) VALUES
  ('manage_vehicles',   'Crear, editar y eliminar vehículos'),
  ('manage_users',      'Crear, editar y eliminar usuarios; gestionar roles'),
  ('manage_trabajos',   'Crear, editar y eliminar trabajos'),
  ('view_all_trabajos', 'Ver todos los trabajos (sin este permiso solo se ven los propios)'),
  ('manage_incidencias','Crear y gestionar incidencias y revisiones de vehículos'),
  ('access_admin',      'Acceder al panel superadmin (logs, auditoría, estadísticas)');

-- ── Asignar permisos a roles ──────────────────────────────────
-- superadmin: todos los permisos
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.nombre = 'superadmin';

-- administrador: todos excepto access_admin (que es solo superadmin)
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.nombre = 'administrador'
    AND p.nombre IN ('manage_vehicles', 'manage_users', 'manage_trabajos', 'view_all_trabajos', 'manage_incidencias');

-- gestor: igual que administrador (restricciones adicionales van en el controller)
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.nombre = 'gestor'
    AND p.nombre IN ('manage_vehicles', 'manage_users', 'manage_trabajos', 'view_all_trabajos', 'manage_incidencias');

-- tecnico, enfermero, medico: solo view_all_trabajos = false → sin permisos de gestión
-- (su acceso está controlado a nivel de query SQL, no de permission middleware)
