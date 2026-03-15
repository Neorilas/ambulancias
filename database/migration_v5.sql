-- ============================================================
-- MIGRACIÓN v5: columna activado_por en trabajos
-- ============================================================
-- Ejecutar sobre la BD existente después de v2, v3 y v4.
-- ============================================================

-- Añadir columna activado_por (FK users, nullable) a trabajos
-- para registrar quién activó manualmente un trabajo programado.
ALTER TABLE `trabajos`
  ADD COLUMN IF NOT EXISTS `activado_por` INT UNSIGNED NULL DEFAULT NULL
    COMMENT 'Usuario que activó manualmente el trabajo',
  ADD CONSTRAINT IF NOT EXISTS `fk_trabajos_activado_por`
    FOREIGN KEY (`activado_por`) REFERENCES `users`(`id`) ON DELETE SET NULL;
