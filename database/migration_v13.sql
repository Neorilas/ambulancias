-- ============================================================
-- MIGRACIÓN v13: Comentarios sobre una incidencia (IDEMPOTENTE)
-- ============================================================
-- NOTA: esto ya se aplica AUTOMÁTICAMENTE al arrancar el backend
-- (backend/src/config/migrations.js → 'v13_incidencia_comentarios'), marcado
-- en la tabla schema_migrations. Este fichero queda como referencia /
-- aplicación manual alternativa.
--
-- Motivo: hasta ahora, cuando el administrador quería añadir información a
-- una incidencia que ya había dado de alta el técnico, la única vía era
-- registrar otra incidencia. El mismo daño acababa duplicado: una entrada con
-- el texto del técnico y otra con el del administrador. Con esta tabla, la
-- incidencia sigue siendo una sola y cada aportación queda como comentario
-- firmado y fechado.
--
-- Se puede ejecutar varias veces sin efecto adverso.
-- ============================================================

CREATE TABLE IF NOT EXISTS `incidencia_comentarios` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `incidencia_id` INT UNSIGNED NOT NULL,
  `user_id`       INT UNSIGNED DEFAULT NULL,
  `comentario`    TEXT NOT NULL,
  `created_at`    DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_inccom_incidencia` (`incidencia_id`, `created_at`),
  CONSTRAINT `fk_inccom_incidencia` FOREIGN KEY (`incidencia_id`)
    REFERENCES `vehicle_incidencias` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_inccom_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
