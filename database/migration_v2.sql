-- ============================================================
-- Migration v2: Historial de revisiones e incidencias
-- Ejecutar una vez sobre la base de datos existente
-- ============================================================

-- ── Historial de revisiones / mantenimiento ──────────────────
CREATE TABLE IF NOT EXISTS vehicle_revisiones (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id      INT NOT NULL,
  tipo            ENUM('itv','its','mantenimiento','revision_preventiva','reparacion','otro') NOT NULL,
  fecha_revision  DATE NOT NULL,
  fecha_proxima   DATE,
  resultado       ENUM('aprobado','rechazado','condicionado','realizado') NOT NULL DEFAULT 'realizado',
  descripcion     TEXT,
  coste           DECIMAL(10,2),
  realizado_por   VARCHAR(200),           -- taller o técnico externo
  created_by      INT NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_vrev_vehicle (vehicle_id),
  INDEX idx_vrev_fecha   (fecha_revision)
);

-- ── Incidencias / daños detectados en servicios ───────────────
CREATE TABLE IF NOT EXISTS vehicle_incidencias (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_id     INT NOT NULL,
  trabajo_id     INT,                                       -- trabajo en que se detectó (nullable)
  reported_by    INT NOT NULL,
  tipo           ENUM('dano_exterior','dano_interior','mecanico','fluido','electrico','otro')
                 NOT NULL DEFAULT 'dano_exterior',
  gravedad       ENUM('leve','moderado','grave') NOT NULL DEFAULT 'leve',
  descripcion    TEXT NOT NULL,
  estado         ENUM('pendiente','en_revision','resuelto') NOT NULL DEFAULT 'pendiente',
  resuelto_by    INT,
  resuelto_at    DATETIME,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (vehicle_id)  REFERENCES vehicles(id)  ON DELETE CASCADE,
  FOREIGN KEY (trabajo_id)  REFERENCES trabajos(id)  ON DELETE SET NULL,
  FOREIGN KEY (reported_by) REFERENCES users(id),
  FOREIGN KEY (resuelto_by) REFERENCES users(id),
  INDEX idx_vinc_vehicle  (vehicle_id),
  INDEX idx_vinc_estado   (estado),
  INDEX idx_vinc_gravedad (gravedad)
);
