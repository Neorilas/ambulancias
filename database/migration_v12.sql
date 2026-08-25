-- ============================================================
-- MIGRACIÓN v12: Hora real de "Inicio de servicio" (IDEMPOTENTE)
-- ============================================================
-- NOTA: esto ya se aplica AUTOMÁTICAMENTE al arrancar el backend
-- (backend/src/config/migrations.js → 'v12_inicio_real_at'), marcado en la
-- tabla schema_migrations. Este fichero queda como referencia / aplicación
-- manual alternativa.
--
-- Registra el instante real en que el responsable pulsa
-- "Inicio de servicio" (activa la asignación), independiente de
-- la fecha_inicio programada.
--
-- Se puede ejecutar varias veces sin efecto adverso.
-- ============================================================

SET @col_inicio_real := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'asignaciones_libres'
    AND COLUMN_NAME  = 'inicio_real_at'
);
SET @sql := IF(@col_inicio_real = 0,
  "ALTER TABLE `asignaciones_libres`
     ADD COLUMN `inicio_real_at` DATETIME NULL DEFAULT NULL
       COMMENT 'Instante real en que se pulsó Inicio de servicio (activación)'
       AFTER `estado`",
  "SELECT 'columna inicio_real_at ya existe, omitido' AS info"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
