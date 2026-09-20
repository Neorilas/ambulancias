-- ============================================================
-- Migración v17 — Suscripciones Web Push
--
-- REFERENCIA. La que se aplica de verdad es la entrada
-- `v17_push_subscriptions` de backend/src/config/migrations.js: el deploy
-- solo reconstruye el backend y nunca ejecuta los .sql de esta carpeta.
--
-- Una fila por navegador/dispositivo, no por usuario. `endpoint` es único
-- porque es lo que identifica al dispositivo ante el servicio de push.
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    INT UNSIGNED NOT NULL,
  endpoint   VARCHAR(512) NOT NULL,
  p256dh     VARCHAR(255) NOT NULL,
  auth       VARCHAR(255) NOT NULL,
  user_agent VARCHAR(255) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_ok_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_endpoint (endpoint),
  KEY idx_push_user (user_id),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
