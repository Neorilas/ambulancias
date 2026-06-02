-- migration_v9.sql — Feature flags (funcionalidades activables por superadmin)
-- Idempotente: seguro para re-ejecutar

CREATE TABLE IF NOT EXISTS app_features (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  feature_key   VARCHAR(60) NOT NULL UNIQUE,
  label         VARCHAR(100) NOT NULL,
  description   VARCHAR(255) DEFAULT NULL,
  category      VARCHAR(40) NOT NULL DEFAULT 'menu',
  enabled       TINYINT(1) NOT NULL DEFAULT 0,
  display_order INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insertar features de menú (solo si no existen)
-- Línea base "solo vehículos": el usuario normal solo ve Mis Asignaciones;
-- el módulo de trabajos queda desactivado (reactivable desde el panel Superadmin).
INSERT IGNORE INTO app_features (feature_key, label, description, category, enabled, display_order) VALUES
  ('menu_dashboard',        'Dashboard',         'Panel principal con resumen',                          'menu', 0, 10),
  ('menu_mis_trabajos',     'Mis Trabajos',      'Lista de trabajos asignados al usuario',               'menu', 0, 20),
  ('menu_trabajos',         'Trabajos',          'Lista general de todos los trabajos',                  'menu', 0, 30),
  ('menu_mis_asignaciones', 'Mis Asignaciones',  'Asignaciones libres del usuario',                      'menu', 1, 40),
  ('menu_asignaciones',     'Asignaciones',      'Gestión de asignaciones libres (admin/gestor)',        'menu', 1, 50),
  ('menu_vehiculos',        'Vehículos',         'Gestión de vehículos/ambulancias (admin/gestor)',      'menu', 1, 60),
  ('menu_usuarios',         'Usuarios',          'Gestión de usuarios del sistema (admin/gestor)',       'menu', 1, 70),
  ('menu_alertas',          'Alertas',           'Alertas de caducidad ITV/ITS/Tarjeta (admin)',         'menu', 1, 80);
