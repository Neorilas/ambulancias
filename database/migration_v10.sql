-- migration_v10.sql — Línea base "solo vehículos" para feature flags
--
-- Reconfigura los menús visibles para dejar al usuario normal SOLO el flujo
-- de vehículos (Mis Asignaciones). El módulo de trabajos queda oculto.
--
-- NOTA: esto ya se aplica AUTOMÁTICAMENTE en el arranque del backend
-- (backend/server.js), una sola vez, marcado en la tabla schema_migrations.
-- Este fichero queda solo como referencia / aplicación manual alternativa.
--
-- Si lo ejecutas a mano: hazlo UNA SOLA VEZ sobre una BD existente (las filas
-- ya creadas por migration_v9 no se actualizan con INSERT IGNORE). En
-- instalaciones nuevas no hace falta: los defaults de migration_v9 ya son estos.
--
-- ALTERNATIVA: el superadmin puede activar/desactivar lo mismo desde el panel
-- (/admin → pestaña "Funcionalidades") sin tocar la BD. No re-ejecutes este
-- script después de ajustar flags desde el panel: volvería a forzar estos valores.

-- Ocultar módulo de trabajos
UPDATE app_features SET enabled = 0 WHERE feature_key IN
  ('menu_dashboard', 'menu_mis_trabajos', 'menu_trabajos');

-- Activar flujo de vehículos / asignaciones (admin/gestor quedan gateados por rol)
UPDATE app_features SET enabled = 1 WHERE feature_key IN
  ('menu_mis_asignaciones', 'menu_asignaciones', 'menu_vehiculos', 'menu_usuarios', 'menu_alertas');
