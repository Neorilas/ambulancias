-- ============================================================
-- MIGRACIÓN v6: Asignaciones libres de vehículos
-- ============================================================

-- Nueva tabla para asignaciones independientes de trabajos
CREATE TABLE IF NOT EXISTS `asignaciones_libres` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `vehicle_id`      INT UNSIGNED NOT NULL,
  `user_id`         INT UNSIGNED NOT NULL          COMMENT 'Usuario responsable',
  `created_by`      INT UNSIGNED NOT NULL          COMMENT 'Admin que creó la asignación',
  `fecha_inicio`    DATETIME     NOT NULL,
  `fecha_fin`       DATETIME     NOT NULL,
  `estado`          ENUM('programada','activa','finalizada','cancelada') NOT NULL DEFAULT 'programada',
  `km_inicio`       INT UNSIGNED NULL DEFAULT NULL,
  `km_fin`          INT UNSIGNED NULL DEFAULT NULL,
  `motivo_fin`      TEXT         NULL DEFAULT NULL COMMENT 'Obligatorio si finalización anticipada',
  `finalizado_por`  INT UNSIGNED NULL DEFAULT NULL,
  `finalizado_at`   DATETIME     NULL DEFAULT NULL,
  `notas`           TEXT         NULL DEFAULT NULL,
  `created_at`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      TIMESTAMP    NULL DEFAULT NULL,

  PRIMARY KEY (`id`),
  INDEX `idx_al_vehicle`  (`vehicle_id`),
  INDEX `idx_al_user`     (`user_id`),
  INDEX `idx_al_estado`   (`estado`),
  INDEX `idx_al_fechas`   (`fecha_inicio`, `fecha_fin`),
  INDEX `idx_al_deleted`  (`deleted_at`),

  CONSTRAINT `fk_al_vehicle`
    FOREIGN KEY (`vehicle_id`)     REFERENCES `vehicles`(`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_al_user`
    FOREIGN KEY (`user_id`)        REFERENCES `users`(`id`)    ON DELETE RESTRICT,
  CONSTRAINT `fk_al_created_by`
    FOREIGN KEY (`created_by`)     REFERENCES `users`(`id`)    ON DELETE RESTRICT,
  CONSTRAINT `fk_al_finalizado_por`
    FOREIGN KEY (`finalizado_por`) REFERENCES `users`(`id`)    ON DELETE SET NULL

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Asignaciones libres de vehículo a usuario, sin estar vinculadas a un trabajo';

-- Añadir FK a vehicle_images para vincular fotos a asignaciones libres
ALTER TABLE `vehicle_images`
  ADD COLUMN `asignacion_id` INT UNSIGNED NULL DEFAULT NULL
    COMMENT 'FK a asignaciones_libres; NULL si es evidencia de un trabajo',
  ADD INDEX `idx_vi_asignacion` (`asignacion_id`),
  ADD CONSTRAINT `fk_vi_asignacion`
    FOREIGN KEY (`asignacion_id`) REFERENCES `asignaciones_libres`(`id`) ON DELETE SET NULL;
