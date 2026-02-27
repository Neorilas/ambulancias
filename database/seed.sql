-- ============================================================
-- DATOS INICIALES - SISTEMA AMBULANCIAS
-- IMPORTANTE: Ejecutar DESPUÉS de schema.sql
-- El usuario administrador se crea con el script:
--   cd backend && node scripts/create-admin.js
-- ============================================================

-- ------------------------------------------------------------
-- Roles base del sistema
-- ------------------------------------------------------------
INSERT INTO `roles` (`nombre`, `descripcion`) VALUES
  ('administrador', 'Acceso completo al sistema. Gestión de usuarios, vehículos y trabajos.'),
  ('gestor',        'Modificar usuarios (sin asignar rol admin), vehículos y trabajos. Sin borrado físico.'),
  ('tecnico',       'Ver trabajos asignados. Subir evidencias al finalizar.'),
  ('enfermero',     'Ver trabajos asignados. Subir evidencias al finalizar.'),
  ('medico',        'Ver trabajos asignados. Subir evidencias al finalizar.');

-- ------------------------------------------------------------
-- El usuario administrador inicial se crea con:
--   cd backend && node scripts/create-admin.js
-- Este script solicita la contraseña de forma segura y genera
-- el hash bcrypt correctamente.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- Vehículos de ejemplo (opcionales - borrar en producción)
-- ------------------------------------------------------------
-- INSERT INTO `vehicles` (`matricula`, `alias`, `kilometros_actuales`) VALUES
--   ('1234-ABC', 'Ambulancia-01', 85000),
--   ('5678-XYZ', 'UVI-Móvil-01',  42000),
--   ('9012-DEF', 'Soporte-Vital', 120000);
