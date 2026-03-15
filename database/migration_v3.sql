-- ============================================================
-- MIGRACIÓN v3: Rol superadmin + tablas de auditoría y errores
-- Ejecutar en producción (Railway) después de migration_v2.sql
-- ============================================================

-- ── Nuevo rol: superadmin ─────────────────────────────────────
INSERT IGNORE INTO roles (nombre, descripcion)
VALUES ('superadmin', 'Super administrador. Acceso completo a logs de errores y auditoría del sistema.');

-- ── Asignar superadmin a Findelias (user_id = 1) ─────────────
INSERT IGNORE INTO user_roles (user_id, role_id)
SELECT 1, id FROM roles WHERE nombre = 'superadmin';

-- ── Tabla de auditoría: quién hizo qué y cuándo ───────────────
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id`          INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED   NULL     DEFAULT NULL  COMMENT 'NULL si usuario eliminado',
  `user_info`   VARCHAR(200)   NOT NULL               COMMENT 'username y nombre en momento de la acción',
  `action`      VARCHAR(100)   NOT NULL               COMMENT 'login | logout | create_trabajo | finalize_trabajo | etc.',
  `entity_type` VARCHAR(50)    NULL     DEFAULT NULL  COMMENT 'trabajos | vehicles | users | ...',
  `entity_id`   INT            NULL     DEFAULT NULL,
  `details`     JSON           NULL     DEFAULT NULL  COMMENT 'Datos contextuales adicionales',
  `ip_address`  VARCHAR(45)    NULL     DEFAULT NULL,
  `user_agent`  VARCHAR(500)   NULL     DEFAULT NULL,
  `created_at`  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  INDEX `idx_created_at` (`created_at` DESC),
  INDEX `idx_user_id`    (`user_id`),
  INDEX `idx_action`     (`action`),
  INDEX `idx_entity`     (`entity_type`, `entity_id`),
  CONSTRAINT `fk_audit_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Registro de auditoría de acciones clave del sistema';

-- ── Tabla de errores 5xx ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS `error_logs` (
  `id`           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `method`       VARCHAR(10)   NULL     DEFAULT NULL,
  `url`          VARCHAR(1000) NULL     DEFAULT NULL,
  `status_code`  SMALLINT      NULL     DEFAULT NULL,
  `error_message` TEXT         NULL     DEFAULT NULL,
  `stack_trace`  TEXT          NULL     DEFAULT NULL,
  `user_id`      INT UNSIGNED  NULL     DEFAULT NULL,
  `user_info`    VARCHAR(200)  NULL     DEFAULT NULL,
  `ip_address`   VARCHAR(45)   NULL     DEFAULT NULL,
  `created_at`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  INDEX `idx_created_at`  (`created_at` DESC),
  INDEX `idx_status_code` (`status_code`),
  INDEX `idx_user_id`     (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Log automático de errores 5xx del servidor';
