-- ============================================================
-- MIGRACIÓN v11: Incidencias vinculadas a asignación + responsable (IDEMPOTENTE)
-- ============================================================
-- Permite registrar una incidencia desde la revisión de una asignación libre
-- y dejarla vinculada a:
--   · la asignación en que se detectó       (asignacion_id)
--   · el técnico responsable de esa asignación (responsable_user_id)
-- La fecha de registro ya queda en created_at.
--
-- Se puede ejecutar varias veces sin efecto adverso.
-- ============================================================

-- ── 1. Columna asignacion_id ────────────────────────────────────────────
SET @col_asig := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'vehicle_incidencias'
    AND COLUMN_NAME  = 'asignacion_id'
);
SET @sql := IF(@col_asig = 0,
  "ALTER TABLE `vehicle_incidencias`
     ADD COLUMN `asignacion_id` INT UNSIGNED NULL DEFAULT NULL AFTER `trabajo_id`,
     ADD INDEX `idx_vinc_asignacion` (`asignacion_id`),
     ADD CONSTRAINT `fk_vinc_asignacion`
       FOREIGN KEY (`asignacion_id`) REFERENCES `asignaciones_libres`(`id`) ON DELETE SET NULL",
  "SELECT 'columna asignacion_id ya existe, omitido' AS info"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 2. Columna responsable_user_id (técnico responsable en esa asignación) ──
SET @col_resp := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'vehicle_incidencias'
    AND COLUMN_NAME  = 'responsable_user_id'
);
SET @sql := IF(@col_resp = 0,
  "ALTER TABLE `vehicle_incidencias`
     ADD COLUMN `responsable_user_id` INT UNSIGNED NULL DEFAULT NULL AFTER `reported_by`,
     ADD INDEX `idx_vinc_responsable` (`responsable_user_id`),
     ADD CONSTRAINT `fk_vinc_responsable`
       FOREIGN KEY (`responsable_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL",
  "SELECT 'columna responsable_user_id ya existe, omitido' AS info"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
