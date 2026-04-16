-- ============================================================
-- MIGRACIÓN v7: Tarjeta de transporte
-- ============================================================
-- Añade la fecha de caducidad de la tarjeta de transporte al
-- vehículo. Vigencia típica de 2 años; la app calcula la próxima
-- caducidad y avisa desde 2 meses antes.
-- ============================================================

ALTER TABLE `vehicles`
  ADD COLUMN `fecha_tarjeta_transporte` DATE NULL DEFAULT NULL
    COMMENT 'Fecha de caducidad de la tarjeta de transporte (vigencia 2 años)'
    AFTER `fecha_its`;

-- Índice para consultas de próximos vencimientos
ALTER TABLE `vehicles`
  ADD INDEX `idx_veh_tarjeta_transporte` (`fecha_tarjeta_transporte`);
