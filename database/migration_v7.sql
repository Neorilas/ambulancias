-- ============================================================
-- MIGRACIÓN v7: Tarjeta de transporte  (IDEMPOTENTE)
-- ============================================================
-- Añade la fecha de caducidad de la tarjeta de transporte al
-- vehículo. Vigencia típica de 2 años; la app calcula la próxima
-- caducidad y avisa desde 2 meses antes.
--
-- Esta migración se puede ejecutar múltiples veces sin efecto
-- adverso: comprueba si la columna/índice ya existen antes de
-- crearlos.
-- ============================================================

-- Añadir columna fecha_tarjeta_transporte si no existe
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'vehicles'
    AND COLUMN_NAME  = 'fecha_tarjeta_transporte'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE `vehicles` ADD COLUMN `fecha_tarjeta_transporte` DATE NULL DEFAULT NULL COMMENT 'Fecha de caducidad de la tarjeta de transporte (vigencia 2 años)' AFTER `fecha_its`",
  "SELECT 'Columna fecha_tarjeta_transporte ya existe, omitido' AS info"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Añadir índice idx_veh_tarjeta_transporte si no existe
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'vehicles'
    AND INDEX_NAME   = 'idx_veh_tarjeta_transporte'
);
SET @sql := IF(@idx_exists = 0,
  "ALTER TABLE `vehicles` ADD INDEX `idx_veh_tarjeta_transporte` (`fecha_tarjeta_transporte`)",
  "SELECT 'Índice idx_veh_tarjeta_transporte ya existe, omitido' AS info"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
