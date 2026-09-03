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

const { query, transaction } = require('./database');
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

/** Aplica `alterSql` solo si el indice no existe todavia. */
async function ensureIndex(table, index, alterSql) {
  const [rows] = await query(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
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

/**
 * Deshace el cruce alias/matricula de la flota y deja la matricula en forma
 * canonica. Idempotente: sobre una flota ya correcta no escribe nada.
 *
 * Solo son candidatas las filas VIVAS. Una fila borrada logicamente lleva la
 * matricula con sufijo __del_<id> (ver deleteVehicle) justo para liberar la
 * matricula real, asi que descruzarla la devolveria a competir por una
 * matricula que ya es de otro vehiculo.
 */
async function descruzarFlota() {
  const { normalizarMatricula, esMatricula, estaCruzado } =
    require('../utils/matricula.utils');

  const [vehiculos] = await query(
    'SELECT id, matricula, alias, deleted_at FROM vehicles ORDER BY id'
  );
  const vivos = vehiculos.filter(v => !v.deleted_at);

  // 1. Valor final de cada fila viva (sin escribir todavia).
  const objetivos = vivos.map(v => {
    const cruzado = estaCruzado(v.matricula, v.alias);
    const matricula = cruzado
      ? normalizarMatricula(v.alias)
      // Si no es una matricula reconocible se deja como esta: normalizarla
      // solo destruiria informacion que habra que revisar a mano.
      : (esMatricula(v.matricula) ? normalizarMatricula(v.matricula) : v.matricula);
    const alias = (cruzado ? v.matricula : v.alias || '').trim();
    return { id: v.id, cruzado, matricula, alias, antes: v };
  });

  // 2. Descartar los que colisionarian con la clave unica de matricula. El
  //    indice uq_matricula cubre tambien las filas borradas, asi que sus
  //    matriculas (con sufijo) cuentan como ocupadas.
  const ocupadas = new Map();
  for (const v of vehiculos) {
    if (v.deleted_at) ocupadas.set(v.matricula, [`#${v.id} (borrado)`]);
  }
  for (const o of objetivos) {
    const lista = ocupadas.get(o.matricula) || [];
    lista.push(`#${o.id}`);
    ocupadas.set(o.matricula, lista);
  }
  const conflictivas = new Set();
  for (const [matricula, lista] of ocupadas) {
    if (lista.length > 1) {
      conflictivas.add(matricula);
      logger.warn(
        `Descruce de flota: matricula duplicada tras normalizar (${matricula}) ` +
        `en ${lista.join(', ')}; se dejan sin tocar`
      );
    }
  }

  const cambios = objetivos.filter(o =>
    !conflictivas.has(o.matricula) &&
    (o.matricula !== o.antes.matricula || o.alias !== o.antes.alias)
  );

  if (!cambios.length) {
    logger.info('Descruce de flota: alias/matricula ya estaban normalizados');
    return;
  }

  // 3. Escritura en dos pasadas para no chocar con uq_matricula mientras
  //    dos filas intercambian valores.
  await transaction(async (conn) => {
    for (const c of cambios) {
      await conn.execute(
        'UPDATE vehicles SET matricula = ? WHERE id = ?',
        [`__SWAP__${c.id}`, c.id]
      );
    }
    for (const c of cambios) {
      await conn.execute(
        'UPDATE vehicles SET matricula = ?, alias = ? WHERE id = ?',
        [c.matricula, c.alias, c.id]
      );
    }
  });

  for (const c of cambios) {
    logger.info(
      `Descruce de flota: vehiculo ${c.id} ${c.cruzado ? 'descruzado' : 'normalizado'} — ` +
      `matricula "${c.antes.matricula}" -> "${c.matricula}", ` +
      `alias "${c.antes.alias}" -> "${c.alias}"`
    );
  }

  // 4. Lo que sigue sin parecer una matricula se reporta para revision. Las
  //    filas borradas quedan fuera: su sufijo __del_<id> es correcto.
  const sospechosos = objetivos.filter(o => !esMatricula(o.matricula));
  if (sospechosos.length) {
    logger.warn(
      `Descruce de flota: ${sospechosos.length} vehiculo(s) con matricula no ` +
      `reconocible, corregir a mano desde la ficha: ` +
      sospechosos.map(o => `#${o.id} "${o.matricula}"`).join(', ')
    );
  }
}

const MIGRATIONS = [
  // ── v2..v8 ────────────────────────────────────────────────────────────────
  // Estas migraciones vivían solo como .sql en /database y se aplicaron a mano
  // sobre producción, así que nunca llegaron a este runner ni al ledger. Sin
  // ellas una base de datos NUEVA (entorno PRE, local, un futuro cliente)
  // arranca con las 10 tablas de schema.sql y le faltan 7. Aquí van reescritas
  // para MySQL 8 y con guardas: sobre una BD que ya las tiene son no-ops.

  {
    name: 'v2_revisiones_incidencias',
    description: 'Historial de revisiones e incidencias de vehículo',
    async run() {
      await query(`CREATE TABLE IF NOT EXISTS vehicle_revisiones (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        vehicle_id      INT UNSIGNED NOT NULL,
        tipo            ENUM('itv','its','mantenimiento','revision_preventiva','reparacion','otro') NOT NULL,
        fecha_revision  DATE NOT NULL,
        fecha_proxima   DATE,
        resultado       ENUM('aprobado','rechazado','condicionado','realizado') NOT NULL DEFAULT 'realizado',
        descripcion     TEXT,
        coste           DECIMAL(10,2),
        realizado_por   VARCHAR(200),
        created_by      INT UNSIGNED NOT NULL,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id),
        INDEX idx_vrev_vehicle (vehicle_id),
        INDEX idx_vrev_fecha   (fecha_revision)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      await query(`CREATE TABLE IF NOT EXISTS vehicle_incidencias (
        id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        vehicle_id     INT UNSIGNED NOT NULL,
        trabajo_id     INT UNSIGNED,
        reported_by    INT UNSIGNED NOT NULL,
        tipo           ENUM('dano_exterior','dano_interior','mecanico','fluido','electrico','otro')
                       NOT NULL DEFAULT 'dano_exterior',
        gravedad       ENUM('leve','moderado','grave') NOT NULL DEFAULT 'leve',
        descripcion    TEXT NOT NULL,
        estado         ENUM('pendiente','en_revision','resuelto') NOT NULL DEFAULT 'pendiente',
        resuelto_by    INT UNSIGNED,
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    },
  },

  {
    name: 'v3_superadmin_auditoria',
    description: 'Rol superadmin + tablas audit_logs y error_logs',
    async run() {
      await query(`INSERT IGNORE INTO roles (nombre, descripcion)
                   VALUES ('superadmin', 'Super administrador. Acceso completo a logs de errores y auditoría del sistema.')`);

      // El .sql original daba superadmin al user_id 1 a pelo. En una BD nueva
      // ese usuario todavía no existe (se crea con scripts/create-admin.js),
      // así que solo se asigna si está.
      const [existe] = await query(`SELECT id FROM users WHERE id = 1`);
      if (existe.length > 0) {
        await query(`INSERT IGNORE INTO user_roles (user_id, role_id)
                     SELECT 1, id FROM roles WHERE nombre = 'superadmin'`);
      }

      await query(`CREATE TABLE IF NOT EXISTS audit_logs (
        id          INT UNSIGNED   NOT NULL AUTO_INCREMENT,
        user_id     INT UNSIGNED   NULL DEFAULT NULL COMMENT 'NULL si usuario eliminado',
        user_info   VARCHAR(200)   NOT NULL          COMMENT 'username y nombre en el momento de la acción',
        action      VARCHAR(100)   NOT NULL,
        entity_type VARCHAR(50)    NULL DEFAULT NULL,
        entity_id   INT            NULL DEFAULT NULL,
        details     JSON           NULL DEFAULT NULL,
        ip_address  VARCHAR(45)    NULL DEFAULT NULL,
        user_agent  VARCHAR(500)   NULL DEFAULT NULL,
        created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_created_at (created_at DESC),
        INDEX idx_user_id    (user_id),
        INDEX idx_action     (action),
        INDEX idx_entity     (entity_type, entity_id),
        CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      await query(`CREATE TABLE IF NOT EXISTS error_logs (
        id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
        method        VARCHAR(10)   NULL DEFAULT NULL,
        url           VARCHAR(1000) NULL DEFAULT NULL,
        status_code   SMALLINT      NULL DEFAULT NULL,
        error_message TEXT          NULL DEFAULT NULL,
        stack_trace   TEXT          NULL DEFAULT NULL,
        user_id       INT UNSIGNED  NULL DEFAULT NULL,
        user_info     VARCHAR(200)  NULL DEFAULT NULL,
        ip_address    VARCHAR(45)   NULL DEFAULT NULL,
        created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_created_at  (created_at DESC),
        INDEX idx_status_code (status_code),
        INDEX idx_user_id     (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    },
  },

  {
    name: 'v4_permisos',
    description: 'Sistema de permisos granular (permissions + role_permissions)',
    async run() {
      await query(`CREATE TABLE IF NOT EXISTS permissions (
        id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
        nombre      VARCHAR(100) NOT NULL,
        descripcion VARCHAR(255) NULL DEFAULT NULL,
        created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_perm_nombre (nombre)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      await query(`CREATE TABLE IF NOT EXISTS role_permissions (
        role_id       INT UNSIGNED NOT NULL,
        permission_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (role_id, permission_id),
        CONSTRAINT fk_rp_role       FOREIGN KEY (role_id)       REFERENCES roles(id)       ON DELETE CASCADE,
        CONSTRAINT fk_rp_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      await query(`INSERT IGNORE INTO permissions (nombre, descripcion) VALUES
        ('manage_vehicles',    'Crear, editar y eliminar vehículos'),
        ('manage_users',       'Crear, editar y eliminar usuarios; gestionar roles'),
        ('manage_trabajos',    'Crear, editar y eliminar trabajos'),
        ('view_all_trabajos',  'Ver todos los trabajos (sin este permiso solo se ven los propios)'),
        ('manage_incidencias', 'Crear y gestionar incidencias y revisiones de vehículos'),
        ('access_admin',       'Acceder al panel superadmin (logs, auditoría, estadísticas)')`);

      // El reparto rol→permiso solo se siembra si la tabla está vacía. Hoy
      // nada la escribe en caliente, pero si mañana se edita desde /admin o a
      // mano, reaplicar los INSERT resucitaría permisos revocados a propósito
      // — el mismo accidente que documenta v10_baseline_vehiculos.
      const [yaSembrado] = await query(`SELECT COUNT(*) AS c FROM role_permissions`);
      if (yaSembrado[0].c === 0) {
        // superadmin: todos los permisos
        await query(`INSERT IGNORE INTO role_permissions (role_id, permission_id)
                     SELECT r.id, p.id FROM roles r, permissions p
                     WHERE r.nombre = 'superadmin'`);

        // administrador y gestor: todos menos access_admin
        await query(`INSERT IGNORE INTO role_permissions (role_id, permission_id)
                     SELECT r.id, p.id FROM roles r, permissions p
                     WHERE r.nombre IN ('administrador','gestor')
                       AND p.nombre IN ('manage_vehicles','manage_users','manage_trabajos',
                                        'view_all_trabajos','manage_incidencias')`);
      }
    },
  },

  {
    name: 'v5_trabajos_activado_por',
    description: 'Columna activado_por en trabajos',
    async run() {
      // El .sql original usaba ADD COLUMN IF NOT EXISTS, que es sintaxis de
      // MariaDB y en MySQL 8 revienta. Por eso aquí va con ensureColumn.
      await ensureColumn('trabajos', 'activado_por',
        `ALTER TABLE trabajos
           ADD COLUMN activado_por INT UNSIGNED NULL DEFAULT NULL
             COMMENT 'Usuario que activó manualmente el trabajo',
           ADD CONSTRAINT fk_trabajos_activado_por
             FOREIGN KEY (activado_por) REFERENCES users(id) ON DELETE SET NULL`);
    },
  },

  {
    name: 'v6_asignaciones_libres',
    description: 'Tabla asignaciones_libres + vínculo desde vehicle_images',
    async run() {
      await query(`CREATE TABLE IF NOT EXISTS asignaciones_libres (
        id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
        vehicle_id     INT UNSIGNED NOT NULL,
        user_id        INT UNSIGNED NOT NULL COMMENT 'Usuario responsable',
        created_by     INT UNSIGNED NOT NULL COMMENT 'Admin que creó la asignación',
        fecha_inicio   DATETIME     NOT NULL,
        fecha_fin      DATETIME     NOT NULL,
        estado         ENUM('programada','activa','finalizada','cancelada') NOT NULL DEFAULT 'programada',
        km_inicio      INT UNSIGNED NULL DEFAULT NULL,
        km_fin         INT UNSIGNED NULL DEFAULT NULL,
        motivo_fin     TEXT         NULL DEFAULT NULL,
        finalizado_por INT UNSIGNED NULL DEFAULT NULL,
        finalizado_at  DATETIME     NULL DEFAULT NULL,
        notas          TEXT         NULL DEFAULT NULL,
        created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at     TIMESTAMP    NULL DEFAULT NULL,
        PRIMARY KEY (id),
        INDEX idx_al_vehicle (vehicle_id),
        INDEX idx_al_user    (user_id),
        INDEX idx_al_estado  (estado),
        INDEX idx_al_fechas  (fecha_inicio, fecha_fin),
        INDEX idx_al_deleted (deleted_at),
        CONSTRAINT fk_al_vehicle        FOREIGN KEY (vehicle_id)     REFERENCES vehicles(id) ON DELETE RESTRICT,
        CONSTRAINT fk_al_user           FOREIGN KEY (user_id)        REFERENCES users(id)    ON DELETE RESTRICT,
        CONSTRAINT fk_al_created_by     FOREIGN KEY (created_by)     REFERENCES users(id)    ON DELETE RESTRICT,
        CONSTRAINT fk_al_finalizado_por FOREIGN KEY (finalizado_por) REFERENCES users(id)    ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

      await ensureColumn('vehicle_images', 'asignacion_id',
        `ALTER TABLE vehicle_images
           ADD COLUMN asignacion_id INT UNSIGNED NULL DEFAULT NULL
             COMMENT 'FK a asignaciones_libres; NULL si es evidencia de un trabajo',
           ADD INDEX idx_vi_asignacion (asignacion_id),
           ADD CONSTRAINT fk_vi_asignacion
             FOREIGN KEY (asignacion_id) REFERENCES asignaciones_libres(id) ON DELETE SET NULL`);
    },
  },

  {
    name: 'v7_tarjeta_transporte',
    description: 'Fecha de caducidad de la tarjeta de transporte',
    async run() {
      await ensureColumn('vehicles', 'fecha_tarjeta_transporte',
        `ALTER TABLE vehicles
           ADD COLUMN fecha_tarjeta_transporte DATE NULL DEFAULT NULL
             COMMENT 'Caducidad de la tarjeta de transporte (vigencia 2 años)'
             AFTER fecha_its`);
      await ensureIndex('vehicles', 'idx_veh_tarjeta_transporte',
        `ALTER TABLE vehicles ADD INDEX idx_veh_tarjeta_transporte (fecha_tarjeta_transporte)`);
    },
  },

  {
    name: 'v8_fotos_inicio_fin',
    description: 'Momento inicio/fin en vehicle_images + nuevos tipos de imagen',
    async run() {
      const [enumRows] = await query(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vehicle_images'
           AND COLUMN_NAME = 'tipo_imagen' AND COLUMN_TYPE LIKE '%nivel_aceite%'`
      );
      if (enumRows[0].c === 0) {
        await query(`ALTER TABLE vehicle_images MODIFY COLUMN tipo_imagen
          ENUM('frontal','lateral_izquierdo','lateral_derecho','trasera',
               'niveles_liquidos','nivel_aceite','nivel_liquidos_general',
               'cuentakilometros','danos') NOT NULL`);
      }

      await ensureColumn('vehicle_images', 'momento',
        `ALTER TABLE vehicle_images
           ADD COLUMN momento ENUM('inicio','fin','general') NOT NULL DEFAULT 'general'
             COMMENT 'inicio = foto al asignarse el vehículo; fin = al finalizar; general = otra'
             AFTER tipo_imagen`);

      await ensureIndex('vehicle_images', 'idx_vi_momento',
        `ALTER TABLE vehicle_images ADD INDEX idx_vi_momento (momento)`);
    },
  },

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

  {
    name: 'v13_incidencia_comentarios',
    description: 'Comentarios firmados sobre una incidencia ya registrada',
    async run() {
      await query(`CREATE TABLE IF NOT EXISTS incidencia_comentarios (
        id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
        incidencia_id INT UNSIGNED NOT NULL,
        user_id       INT UNSIGNED DEFAULT NULL,
        comentario    TEXT NOT NULL,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_inccom_incidencia (incidencia_id, created_at),
        CONSTRAINT fk_inccom_incidencia FOREIGN KEY (incidencia_id)
          REFERENCES vehicle_incidencias(id) ON DELETE CASCADE,
        CONSTRAINT fk_inccom_user FOREIGN KEY (user_id)
          REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    },
  },

  {
    name: 'v14_normalizar_alias_matricula',
    description: 'Deshace el cruce alias/matricula en los vehiculos ya dados de alta',
    async run() {
      await descruzarFlota();
    },
  },

  {
    name: 'v15_descruzar_vehiculos_restantes',
    description: 'Remata el descruce en las bases donde v14 corrio con el criterio viejo',
    async run() {
      // v14 tomo como candidatas TODAS las filas, tambien las borradas. En
      // produccion eso dejo un vehiculo vivo sin corregir: su matricula
      // objetivo chocaba con la de una fila borrada que apunta a la misma
      // matricula. El borrado logico ya libera la matricula con el sufijo
      // __del_<id>, asi que las filas borradas no deben competir por ella.
      // Sobre una base donde v14 ya hizo bien el trabajo, esto es un no-op.
      await descruzarFlota();
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
