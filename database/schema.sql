-- ============================================================
-- SISTEMA DE GESTIÓN - EMPRESA PRIVADA DE AMBULANCIAS
-- Base de Datos MySQL - Schema Completo
-- Versión: 1.0.0
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;
SET sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- ------------------------------------------------------------
-- Eliminar tablas en orden inverso de dependencias
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `vehicle_images`;
DROP TABLE IF EXISTS `trabajo_usuarios`;
DROP TABLE IF EXISTS `trabajo_vehiculos`;
DROP TABLE IF EXISTS `trabajos`;
DROP TABLE IF EXISTS `refresh_tokens`;
DROP TABLE IF EXISTS `login_attempts`;
DROP TABLE IF EXISTS `user_roles`;
DROP TABLE IF EXISTS `roles`;
DROP TABLE IF EXISTS `vehicles`;
DROP TABLE IF EXISTS `users`;

-- ============================================================
-- TABLA: users
-- ============================================================
CREATE TABLE `users` (
  `id`            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(50)     NOT NULL,
  `password_hash` VARCHAR(255)    NOT NULL,
  `email`         VARCHAR(100)    NULL       DEFAULT NULL,
  `nombre`        VARCHAR(100)    NOT NULL,
  `apellidos`     VARCHAR(150)    NOT NULL,
  `dni`           VARCHAR(20)     NOT NULL,
  `direccion`     VARCHAR(255)    NULL       DEFAULT NULL,
  `telefono`      VARCHAR(20)     NULL       DEFAULT NULL,
  `activo`        TINYINT(1)      NOT NULL   DEFAULT 1,
  `created_at`    TIMESTAMP       NOT NULL   DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    TIMESTAMP       NOT NULL   DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    TIMESTAMP       NULL       DEFAULT NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_username`  (`username`),
  UNIQUE KEY `uq_dni`       (`dni`),
  UNIQUE KEY `uq_email`     (`email`),
  INDEX `idx_activo`        (`activo`),
  INDEX `idx_deleted_at`    (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Tabla principal de usuarios del sistema';

-- ============================================================
-- TABLA: roles
-- ============================================================
CREATE TABLE `roles` (
  `id`          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `nombre`      VARCHAR(50)   NOT NULL,
  `descripcion` VARCHAR(255)  NULL     DEFAULT NULL,
  `created_at`  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_role_nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Roles del sistema. Administrable desde panel de administración';

-- ============================================================
-- TABLA: user_roles  (relación N:M usuarios-roles)
-- ============================================================
CREATE TABLE `user_roles` (
  `user_id`     INT UNSIGNED  NOT NULL,
  `role_id`     INT UNSIGNED  NOT NULL,
  `assigned_at` TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `assigned_by` INT UNSIGNED  NULL     DEFAULT NULL,

  PRIMARY KEY (`user_id`, `role_id`),
  CONSTRAINT `fk_ur_user` FOREIGN KEY (`user_id`)
    REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_ur_role` FOREIGN KEY (`role_id`)
    REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_ur_assigned_by` FOREIGN KEY (`assigned_by`)
    REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Tabla pivote: un usuario puede tener 1..N roles';

-- ============================================================
-- TABLA: login_attempts
-- Control de intentos de login para rate limiting y bloqueo
-- ============================================================
CREATE TABLE `login_attempts` (
  `id`           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `username`     VARCHAR(50)   NOT NULL,
  `ip_address`   VARCHAR(45)   NOT NULL,
  `success`      TINYINT(1)    NOT NULL DEFAULT 0,
  `user_agent`   VARCHAR(500)  NULL     DEFAULT NULL,
  `attempted_at` TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  INDEX `idx_la_username_time` (`username`, `attempted_at`),
  INDEX `idx_la_ip_time`       (`ip_address`, `attempted_at`),
  INDEX `idx_la_attempted_at`  (`attempted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Registro de intentos de login para seguridad. Limpiar periódicamente con EVENT.';

-- ============================================================
-- TABLA: refresh_tokens
-- ============================================================
CREATE TABLE `refresh_tokens` (
  `id`           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `user_id`      INT UNSIGNED  NOT NULL,
  `token_hash`   VARCHAR(255)  NOT NULL  COMMENT 'SHA-256 del refresh token',
  `expires_at`   TIMESTAMP     NOT NULL,
  `revoked`      TINYINT(1)    NOT NULL  DEFAULT 0,
  `revoked_at`   TIMESTAMP     NULL      DEFAULT NULL,
  `ip_address`   VARCHAR(45)   NULL      DEFAULT NULL,
  `user_agent`   VARCHAR(500)  NULL      DEFAULT NULL,
  `created_at`   TIMESTAMP     NOT NULL  DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_token_hash` (`token_hash`),
  INDEX `idx_rt_user`        (`user_id`),
  INDEX `idx_rt_expires`     (`expires_at`),
  CONSTRAINT `fk_rt_user` FOREIGN KEY (`user_id`)
    REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Refresh tokens JWT. El token real se envía al cliente, aquí se guarda el hash.';

-- ============================================================
-- TABLA: vehicles
-- ============================================================
CREATE TABLE `vehicles` (
  `id`                    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `matricula`             VARCHAR(20)   NOT NULL,
  `alias`                 VARCHAR(100)  NOT NULL,
  `kilometros_actuales`   INT UNSIGNED  NOT NULL DEFAULT 0,
  `fecha_ultima_revision` DATE          NULL     DEFAULT NULL,
  `fecha_ultimo_servicio` DATE          NULL     DEFAULT NULL,
  `created_at`            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`            TIMESTAMP     NULL     DEFAULT NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_matricula` (`matricula`),
  INDEX `idx_veh_deleted_at` (`deleted_at`),
  INDEX `idx_veh_alias`      (`alias`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Flota de vehículos de la empresa';

-- ============================================================
-- TABLA: trabajos
-- ============================================================
CREATE TABLE `trabajos` (
  `id`                               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `identificador`                    VARCHAR(50)   NOT NULL  COMMENT 'Ej: TRB-2024-0001',
  `nombre`                           VARCHAR(255)  NOT NULL,
  `tipo`                             ENUM('traslado','cobertura_evento','otro') NOT NULL DEFAULT 'traslado',
  `fecha_inicio`                     DATETIME      NOT NULL,
  `fecha_fin`                        DATETIME      NOT NULL,
  `estado`                           ENUM('programado','activo','finalizado','finalizado_anticipado') NOT NULL DEFAULT 'programado',
  `motivo_finalizacion_anticipada`   TEXT          NULL     DEFAULT NULL,
  `created_by`                       INT UNSIGNED  NOT NULL,
  `created_at`                       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`                       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`                       TIMESTAMP     NULL     DEFAULT NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_identificador`   (`identificador`),
  INDEX `idx_trab_estado`         (`estado`),
  INDEX `idx_trab_fecha_inicio`   (`fecha_inicio`),
  INDEX `idx_trab_fecha_fin`      (`fecha_fin`),
  INDEX `idx_trab_deleted_at`     (`deleted_at`),
  INDEX `idx_trab_created_by`     (`created_by`),
  CONSTRAINT `fk_trab_created_by` FOREIGN KEY (`created_by`)
    REFERENCES `users`(`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Trabajos/servicios: traslados, coberturas de eventos, etc.';

-- ============================================================
-- TABLA: trabajo_vehiculos
-- Vehículos asignados a un trabajo + responsable + km
-- ============================================================
CREATE TABLE `trabajo_vehiculos` (
  `id`                  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `trabajo_id`          INT UNSIGNED  NOT NULL,
  `vehicle_id`          INT UNSIGNED  NOT NULL,
  `responsable_user_id` INT UNSIGNED  NOT NULL,
  `kilometros_inicio`   INT UNSIGNED  NULL     DEFAULT NULL,
  `kilometros_fin`      INT UNSIGNED  NULL     DEFAULT NULL,

  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tv_trabajo_vehicle` (`trabajo_id`, `vehicle_id`),
  INDEX `idx_tv_vehicle`     (`vehicle_id`),
  INDEX `idx_tv_responsable` (`responsable_user_id`),
  CONSTRAINT `fk_tv_trabajo` FOREIGN KEY (`trabajo_id`)
    REFERENCES `trabajos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_tv_vehicle` FOREIGN KEY (`vehicle_id`)
    REFERENCES `vehicles`(`id`) ON UPDATE CASCADE,
  CONSTRAINT `fk_tv_responsable` FOREIGN KEY (`responsable_user_id`)
    REFERENCES `users`(`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Relación trabajo-vehículo con responsable asignado y kilómetros';

-- ============================================================
-- TABLA: trabajo_usuarios
-- Personal asignado a un trabajo
-- ============================================================
CREATE TABLE `trabajo_usuarios` (
  `trabajo_id` INT UNSIGNED NOT NULL,
  `user_id`    INT UNSIGNED NOT NULL,

  PRIMARY KEY (`trabajo_id`, `user_id`),
  INDEX `idx_tu_user` (`user_id`),
  CONSTRAINT `fk_tu_trabajo` FOREIGN KEY (`trabajo_id`)
    REFERENCES `trabajos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_tu_user` FOREIGN KEY (`user_id`)
    REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Personal (técnicos, enfermeros, médicos) asignados a un trabajo';

-- ============================================================
-- TABLA: vehicle_images
-- Fotos de vehículos (per trabajo o generales)
-- ============================================================
CREATE TABLE `vehicle_images` (
  `id`           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `vehicle_id`   INT UNSIGNED  NOT NULL,
  `tipo_imagen`  ENUM('frontal','lateral_derecho','trasera','lateral_izquierdo','liquidos') NOT NULL,
  `image_url`    VARCHAR(500)  NOT NULL,
  `trabajo_id`   INT UNSIGNED  NULL     DEFAULT NULL  COMMENT 'NULL = imagen general; FK = imagen de finalización de trabajo',
  `uploaded_by`  INT UNSIGNED  NULL     DEFAULT NULL,
  `created_at`   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  INDEX `idx_vi_vehicle`   (`vehicle_id`),
  INDEX `idx_vi_trabajo`   (`trabajo_id`),
  INDEX `idx_vi_tipo`      (`tipo_imagen`),
  CONSTRAINT `fk_vi_vehicle` FOREIGN KEY (`vehicle_id`)
    REFERENCES `vehicles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_vi_trabajo` FOREIGN KEY (`trabajo_id`)
    REFERENCES `trabajos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_vi_uploaded_by` FOREIGN KEY (`uploaded_by`)
    REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Imágenes de vehículos. Las de finalización de trabajo llevan trabajo_id.';

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- VISTAS ÚTILES
-- ============================================================

-- Vista: usuarios con sus roles
CREATE OR REPLACE VIEW `v_users_roles` AS
SELECT
  u.id,
  u.username,
  u.nombre,
  u.apellidos,
  u.email,
  u.activo,
  u.deleted_at,
  GROUP_CONCAT(r.nombre ORDER BY r.nombre SEPARATOR ',') AS roles
FROM users u
LEFT JOIN user_roles ur ON u.id = ur.user_id
LEFT JOIN roles r ON ur.role_id = r.id
WHERE u.deleted_at IS NULL
GROUP BY u.id;

-- Vista: trabajos activos con vehículos y responsables
CREATE OR REPLACE VIEW `v_trabajos_activos` AS
SELECT
  t.id,
  t.identificador,
  t.nombre,
  t.tipo,
  t.fecha_inicio,
  t.fecha_fin,
  t.estado,
  v.matricula,
  v.alias AS vehiculo_alias,
  CONCAT(u.nombre, ' ', u.apellidos) AS responsable
FROM trabajos t
JOIN trabajo_vehiculos tv ON t.id = tv.trabajo_id
JOIN vehicles v ON tv.vehicle_id = v.id
JOIN users u ON tv.responsable_user_id = u.id
WHERE t.deleted_at IS NULL
  AND t.estado IN ('programado', 'activo');

-- ============================================================
-- EVENTO: limpieza automática de login_attempts (>30 días)
-- Requiere que el event_scheduler esté activo en MySQL
-- SET GLOBAL event_scheduler = ON;
-- ============================================================
DELIMITER //
CREATE EVENT IF NOT EXISTS `ev_clean_login_attempts`
  ON SCHEDULE EVERY 1 DAY
  STARTS CURRENT_TIMESTAMP
  DO
  BEGIN
    DELETE FROM login_attempts
    WHERE attempted_at < DATE_SUB(NOW(), INTERVAL 30 DAY);
  END //
DELIMITER ;

-- ============================================================
-- EVENTO: limpieza de refresh_tokens expirados
-- ============================================================
DELIMITER //
CREATE EVENT IF NOT EXISTS `ev_clean_expired_tokens`
  ON SCHEDULE EVERY 1 HOUR
  STARTS CURRENT_TIMESTAMP
  DO
  BEGIN
    DELETE FROM refresh_tokens
    WHERE expires_at < NOW() OR revoked = 1;
  END //
DELIMITER ;
