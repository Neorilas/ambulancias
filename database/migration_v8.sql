-- ============================================================
-- MIGRACIÓN v8: Fotos de inicio y fin separadas (IDEMPOTENTE)
-- ============================================================
-- Reorganiza el flujo de fotos de vehículo en dos momentos:
--   · INICIO  → 4 fotos walk-around + 2 de líquidos (aceite + otros)
--   · FIN     → 4 fotos walk-around + cuentakilómetros
-- Cambios:
--   1. Añade valores al ENUM tipo_imagen: 'nivel_aceite', 'nivel_liquidos_general'
--      (el histórico 'niveles_liquidos' se mantiene por compatibilidad)
--   2. Añade columna 'momento' ENUM('inicio','fin','general') con default 'general'
--      (las imágenes antiguas quedan como 'general' y siguen accesibles)
--   3. Ajusta el índice para reflejar la tupla (vehicle_id, trabajo_id, tipo, momento)
--
-- Se puede ejecutar varias veces sin efecto adverso.
-- ============================================================

-- ── 1. Ampliar ENUM tipo_imagen (si aún no tiene los nuevos valores) ─────
SET @enum_has_new := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'vehicle_images'
    AND COLUMN_NAME  = 'tipo_imagen'
    AND COLUMN_TYPE LIKE '%nivel_aceite%'
);
SET @sql := IF(@enum_has_new = 0,
  "ALTER TABLE `vehicle_images` MODIFY COLUMN `tipo_imagen`
     ENUM('frontal','lateral_izquierdo','lateral_derecho','trasera',
          'niveles_liquidos','nivel_aceite','nivel_liquidos_general',
          'cuentakilometros','danos') NOT NULL",
  "SELECT 'ENUM tipo_imagen ya incluye los nuevos valores, omitido' AS info"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 2. Añadir columna `momento` si no existe ────────────────────────────
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'vehicle_images'
    AND COLUMN_NAME  = 'momento'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE `vehicle_images`
    ADD COLUMN `momento` ENUM('inicio','fin','general') NOT NULL DEFAULT 'general'
      COMMENT 'inicio = foto al asignarse el vehículo; fin = foto al finalizar; general = otra'
      AFTER `tipo_imagen`",
  "SELECT 'Columna momento ya existe, omitido' AS info"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 3. Índice para consulta de progreso por trabajo/asignación+momento ──
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'vehicle_images'
    AND INDEX_NAME   = 'idx_vi_momento'
);
SET @sql := IF(@idx_exists = 0,
  "ALTER TABLE `vehicle_images` ADD INDEX `idx_vi_momento` (`momento`)",
  "SELECT 'Índice idx_vi_momento ya existe, omitido' AS info"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
