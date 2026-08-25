/**
 * config/migrations.js
 * Runner de migraciones idempotentes que se ejecuta al arrancar el backend.
 *
 * ALCANCE — este runner SOLO toca la base de datos de este proyecto:
 *   - usa el pool de `config/database.js`, es decir la BD de DB_NAME/MYSQL_URL
 *     configurada para este backend (en Docker: el servicio `mysql` de la red
 *     interna de este docker-compose);
 *   - todas las comprobaciones se hacen contra `TABLE_SCHEMA = DATABASE()`;
 *   - ninguna sentencia cualifica un esquema distinto del actual.
 * Por tanto no puede afectar a otros proyectos alojados en la misma máquina.
 *
 * CÓMO AÑADIR UNA MIGRACIÓN
 *   1. Escribe el .sql en /database (referencia y aplicación manual).
 *   2. Añade una entrada al array MIGRATIONS de abajo, con el mismo número.
 *   3. Hazla idempotente (guards con ensureColumn o IF NOT EXISTS).
 * Si no se añade aquí, la migración NO se aplica en producción: el deploy
 * reconstruye solo el backend y nunca toca MySQL.
 */

'use strict';

const { query } = require('./database');
const logger    = require('../utils/logger.utils');

// ============================================================
// Helpers idempotentes
// ============================================================

/** Aplica `alterSql` solo si la columna no existe todavía. */
async function ensureColumn(table, column, alterSql) {
  const [rows] = await query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (rows[0].c === 0) {
    await query(alterSql);
    return true;
  }
  return false;
}

/** Crea la tabla de control de migraciones si no existe. */
async function ensureLedger() {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

async function isApplied(name) {
  const [rows] = await query(`SELECT name FROM schema_migrations WHERE name = ?`, [name]);
  return rows.length > 0;
}

async function markApplied(name) {
  await query(`INSERT IGNORE INTO schema_migrations (name) VALUES (?)`, [name]);
}

// ============================================================
// Migraciones (orden de ejecución)
// ============================================================
// `name` se guarda en schema_migrations: NO renombrar las ya desplegadas.
// En concreto 'v10_baseline_vehiculos' debe conservar ese nombre exacto: si se
// reaplicara pisaría los flags que el superadmin haya cambiado desde /admin.

const MIGRATIONS = [
  {
    name: 'v9_app_features',
    description: 'Tabla app_features + flags de menú por defecto',
    async run() {
      await query(`CREATE TABLE IF NOT EXISTS app_features (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        feature_key   VARCHAR(60) NOT NULL UNIQUE,
        label         VARCHAR(100) NOT NULL,
        description   VARCHAR(255) DEFAULT NULL,
        category      VARCHAR(40) NOT NULL DEFAULT 'menu',
        enabled       TINYINT(1) NOT NULL DEFAULT 0,
        display_order INT NOT NULL DEFAULT 0,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      await query(`INSERT IGNORE INTO app_features (feature_key, label, description, category, enabled, display_order) VALUES
        ('menu_dashboard',        'Dashboard',         'Panel principal con resumen',                     'menu', 0, 10),
        ('menu_mis_trabajos',     'Mis Trabajos',      'Lista de trabajos asignados al usuario',          'menu', 0, 20),
        ('menu_trabajos',         'Trabajos',          'Lista general de todos los trabajos',             'menu', 0, 30),
        ('menu_mis_asignaciones', 'Mis Asignaciones',  'Asignaciones libres del usuario',                 'menu', 1, 40),
        ('menu_asignaciones',     'Asignaciones',      'Gestión de asignaciones libres (admin/gestor)',   'menu', 1, 50),
        ('menu_vehiculos',        'Vehículos',         'Gestión de vehículos/ambulancias (admin/gestor)', 'menu', 1, 60),
        ('menu_usuarios',         'Usuarios',          'Gestión de usuarios del sistema (admin/gestor)',  'menu', 1, 70),
        ('menu_alertas',          'Alertas',           'Alertas de caducidad ITV/ITS/Tarjeta (admin)',    'menu', 1, 80)`);
    },
  },

  {
    name: 'v10_baseline_vehiculos',
    description: 'Línea base "solo vehículos": oculta trabajos, activa asignaciones',
    // Solo una vez: el INSERT IGNORE de v9 no actualiza filas ya creadas, pero
    // reaplicarlo pisaría los toggles posteriores del panel de superadmin.
    async run() {
      await query(`UPDATE app_features SET enabled = 0
                   WHERE feature_key IN ('menu_dashboard','menu_mis_trabajos','menu_trabajos')`);
      await query(`UPDATE app_features SET enabled = 1
                   WHERE feature_key IN ('menu_mis_asignaciones','menu_asignaciones','menu_vehiculos','menu_usuarios','menu_alertas')`);
    },
  },

  {
    name: 'v11_incidencias_asignacion',
    description: 'Incidencias vinculadas a asignación + técnico responsable',
    async run() {
      await ensureColumn('vehicle_incidencias', 'asignacion_id',
        `ALTER TABLE vehicle_incidencias
           ADD COLUMN asignacion_id INT UNSIGNED NULL DEFAULT NULL AFTER trabajo_id,
           ADD INDEX idx_vinc_asignacion (asignacion_id),
           ADD CONSTRAINT fk_vinc_asignacion FOREIGN KEY (asignacion_id)
             REFERENCES asignaciones_libres(id) ON DELETE SET NULL`);
      await ensureColumn('vehicle_incidencias', 'responsable_user_id',
        `ALTER TABLE vehicle_incidencias
           ADD COLUMN responsable_user_id INT UNSIGNED NULL DEFAULT NULL AFTER reported_by,
           ADD INDEX idx_vinc_responsable (responsable_user_id),
           ADD CONSTRAINT fk_vinc_responsable FOREIGN KEY (responsable_user_id)
             REFERENCES users(id) ON DELETE SET NULL`);
    },
  },

  {
    name: 'v12_inicio_real_at',
    description: 'Hora real de "Inicio de servicio" en asignaciones_libres',
    async run() {
      await ensureColumn('asignaciones_libres', 'inicio_real_at',
        `ALTER TABLE asignaciones_libres
           ADD COLUMN inicio_real_at DATETIME NULL DEFAULT NULL
             COMMENT 'Instante real en que se pulsó Inicio de servicio (activación)'
             AFTER estado`);
    },
  },
];

// ============================================================
// Runner
// ============================================================

/**
 * Ejecuta las migraciones pendientes en orden.
 * No lanza: si una falla se registra a nivel error y se detiene la cadena,
 * pero el servidor sigue en pie para poder diagnosticar (health check y logs).
 *
 * @returns {Promise<{aplicadas: string[], fallida: string|null}>}
 */
async function runMigrations() {
  const aplicadas = [];

  try {
    await ensureLedger();
  } catch (err) {
    logger.error(`Migraciones: no se pudo crear/leer schema_migrations: ${err.message}`);
    return { aplicadas, fallida: 'schema_migrations' };
  }

  for (const migration of MIGRATIONS) {
    try {
      if (await isApplied(migration.name)) continue;

      await migration.run();
      await markApplied(migration.name);
      aplicadas.push(migration.name);
      logger.info(`Migración aplicada: ${migration.name} — ${migration.description}`);
    } catch (err) {
      // Se detiene la cadena: las siguientes pueden depender de esta.
      logger.error(
        `Migración FALLIDA: ${migration.name} — ${err.message}. ` +
        `El esquema puede estar incompleto; revisa los logs del backend.`,
        err.stack
      );
      return { aplicadas, fallida: migration.name };
    }
  }

  if (aplicadas.length === 0) {
    logger.info('Migraciones: esquema al día, nada que aplicar');
  }
  return { aplicadas, fallida: null };
}

module.exports = { runMigrations, MIGRATIONS, ensureColumn };
