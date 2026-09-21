'use strict';

const { query, transaction } = require('../../../config/database');
const { runMigrations, MIGRATIONS } = require('../../../config/migrations');

const TODAS = MIGRATIONS.map(m => m.name);

/**
 * Reescrituras de FILA: las de v16 enlazan valores y un id. Las migraciones
 * posteriores pueden lanzar sus propios UPDATE de limpieza (v19), que van sin
 * parámetros y no tienen nada que ver con lo que miden los tests de v16.
 */
function reescrituras(updates) {
  return updates.filter(u => u.params.length > 0);
}

/** Todas las migraciones hasta `nombre` incluido, en el orden real del runner. */
function hasta(nombre) {
  return TODAS.slice(0, TODAS.indexOf(nombre) + 1);
}

/**
 * Simula la BD para el runner.
 * @param {string[]} aplicadas  nombres ya presentes en schema_migrations
 * @param {string[]} columnas   columnas existentes, en formato "tabla.columna"
 * @param {string[]} indices    índices existentes, en formato "tabla.indice"
 * @param {string[]} tablas     tablas existentes (para v16)
 * @param {object}   filas      filas por tabla que devuelve el SELECT de v16
 * @param {string[]} autoActualizan  columnas con ON UPDATE CURRENT_TIMESTAMP
 * @param {number}   permisosSembrados  filas en role_permissions
 * @param {boolean}  existeUser1 si users tiene el id 1
 * @param {string}   fallarEn   fragmento de SQL que debe lanzar error
 */
function mockDb({
  aplicadas = [], columnas = [], indices = [], tablas = [], filas = {},
  autoActualizan = [],
  permisosSembrados = 0, existeUser1 = false, fallarEn = null,
} = {}) {
  const ejecutadas = [];
  const ledger     = [...aplicadas];
  const updates    = [];

  // clearAllMocks no drena las colas de mockResolvedValueOnce: reset explícito
  query.mockReset();
  query.mockImplementation(async (sql, params = []) => {
    ejecutadas.push(sql);

    if (fallarEn && sql.includes(fallarEn)) throw new Error('fallo SQL simulado');

    // v16 pregunta primero si la tabla existe, luego qué columnas DATETIME
    // tiene, lee las filas a corregir y las reescribe una a una.
    if (sql.includes('information_schema.TABLES')) {
      return [[{ c: tablas.includes(params[0]) ? 1 : 0 }]];
    }
    if (sql.includes('information_schema.COLUMNS') && sql.includes("DATA_TYPE = 'datetime'")) {
      const tabla = params[0];
      return [columnas
        .filter(c => c.startsWith(`${tabla}.`))
        .map(c => ({
          COLUMN_NAME: c.split('.')[1],
          EXTRA: autoActualizan.includes(c)
            ? 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP' : 'DEFAULT_GENERATED',
        }))];
    }
    if (/^SELECT id, .* FROM \w+ WHERE/.test(sql)) {
      const tabla = sql.match(/FROM (\w+) WHERE/)[1];
      return [filas[tabla] || []];
    }
    if (sql.startsWith('UPDATE ')) {
      updates.push({ sql, params });
      return [{ affectedRows: 1 }];
    }

    // v8 comprueba el ENUM de tipo_imagen por COLUMN_TYPE, sin parámetros.
    if (sql.includes('information_schema.COLUMNS') && sql.includes('COLUMN_TYPE LIKE')) {
      return [[{ c: columnas.includes('vehicle_images.tipo_imagen@nuevo') ? 1 : 0 }]];
    }
    if (sql.includes('information_schema.COLUMNS')) {
      const [tabla, columna] = params;
      return [[{ c: columnas.includes(`${tabla}.${columna}`) ? 1 : 0 }]];
    }
    if (sql.includes('information_schema.STATISTICS')) {
      const [tabla, indice] = params;
      return [[{ c: indices.includes(`${tabla}.${indice}`) ? 1 : 0 }]];
    }
    if (sql.includes('COUNT(*) AS c FROM role_permissions')) {
      return [[{ c: permisosSembrados }]];
    }
    if (sql.includes('SELECT id FROM users WHERE id = 1')) {
      return [existeUser1 ? [{ id: 1 }] : []];
    }
    if (sql.startsWith('SELECT name FROM schema_migrations')) {
      return [ledger.includes(params[0]) ? [{ name: params[0] }] : []];
    }
    if (sql.startsWith('INSERT IGNORE INTO schema_migrations')) {
      ledger.push(params[0]);
      return [{ affectedRows: 1 }];
    }
    return [[]];
  });

  // v16 hace sus UPDATE dentro de una transacción; el conn simulado reenvía
  // al mismo manejador para que `updates` los recoja igual.
  transaction.mockReset();
  transaction.mockImplementation(async (cb) => cb({
    execute: (sql, params) => query(sql, params),
    query:   (sql, params) => query(sql, params),
  }));

  return { ejecutadas, ledger, updates };
}

describe('runMigrations', () => {
  it('crea la tabla de control antes de nada', async () => {
    const { ejecutadas } = mockDb();
    await runMigrations();
    expect(ejecutadas[0]).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');
  });

  it('aplica todas las migraciones en una BD sin registrar y las apunta en el ledger', async () => {
    const { ledger } = mockDb();
    const { aplicadas, fallida } = await runMigrations();

    expect(fallida).toBeNull();
    expect(aplicadas).toEqual(TODAS);
    expect(ledger).toEqual(expect.arrayContaining(TODAS));
  });

  it('no reaplica las migraciones ya registradas', async () => {
    const { ejecutadas } = mockDb({ aplicadas: TODAS });
    const { aplicadas, fallida } = await runMigrations();

    expect(fallida).toBeNull();
    expect(aplicadas).toEqual([]);
    expect(ejecutadas.some(sql => sql.includes('ALTER TABLE'))).toBe(false);
    // v10 pisaría los flags del panel de superadmin si se reaplicara
    expect(ejecutadas.some(sql => sql.includes('UPDATE app_features'))).toBe(false);
  });

  it('sobre una BD vacía crea las 7 tablas que schema.sql no trae', async () => {
    // Motivo de este test: v2..v8 se aplicaron a mano en producción y durante
    // meses no estuvieron en el runner. Una BD nueva (PRE, local) arrancaba sin
    // ellas y la API devolvía 500 en cuanto se tocaba una asignación.
    const { ejecutadas } = mockDb();
    const { fallida } = await runMigrations();

    expect(fallida).toBeNull();
    const sql = ejecutadas.join('\n');
    for (const tabla of [
      'vehicle_revisiones', 'vehicle_incidencias', 'audit_logs', 'error_logs',
      'permissions', 'role_permissions', 'asignaciones_libres',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${tabla}`);
    }
  });

  it('v17 crea push_subscriptions con el endpoint como clave única', async () => {
    // El UNIQUE sobre `endpoint` es lo que hace que volver a pulsar «Activar
    // avisos» en el mismo navegador actualice la fila en vez de duplicarla.
    const { ejecutadas } = mockDb();
    const { fallida } = await runMigrations();

    expect(fallida).toBeNull();
    const sql = ejecutadas.find(q => q.includes('CREATE TABLE IF NOT EXISTS push_subscriptions'));
    expect(sql).toBeDefined();
    expect(sql).toMatch(/UNIQUE KEY uq_push_endpoint \(endpoint\)/);
    // Al borrar un usuario se van sus suscripciones: si no, quedarían filas
    // apuntando a nadie y el JOIN de destinatarios las arrastraría.
    expect(sql).toMatch(/ON DELETE CASCADE/);
  });

  it('v17 se aplica sobre una base que venía de v16', async () => {
    const { ejecutadas, ledger } = mockDb({ aplicadas: hasta('v16_horas_a_utc') });
    const { aplicadas, fallida } = await runMigrations();

    expect(fallida).toBeNull();
    expect(aplicadas).toEqual(TODAS.slice(TODAS.indexOf('v17_push_subscriptions')));
    expect(ledger).toContain('v17_push_subscriptions');
    expect(ejecutadas.some(q => q.includes('push_subscriptions'))).toBe(true);
  });

  it('v18 + v19 dejan la columna con el nombre nuevo sobre una base que venía de v17', async () => {
    const { ejecutadas, ledger } = mockDb({ aplicadas: hasta('v17_push_subscriptions') });
    const { aplicadas, fallida } = await runMigrations();

    expect(fallida).toBeNull();
    expect(aplicadas).toEqual(TODAS.slice(TODAS.indexOf('v18_aviso_fotos_inicio_pendientes')));
    expect(ledger).toContain('v19_aviso_sin_iniciar');
    expect(ejecutadas.some(sql =>
      sql.includes('RENAME COLUMN aviso_fotos_pendientes_at TO aviso_sin_iniciar_at')
    )).toBe(true);
  });

  it('v19 no renombra nada si la base ya tiene el nombre nuevo', async () => {
    const { ejecutadas } = mockDb({
      aplicadas: hasta('v18_aviso_fotos_inicio_pendientes'),
      columnas:  ['asignaciones_libres.aviso_sin_iniciar_at'],
    });
    const { fallida } = await runMigrations();

    expect(fallida).toBeNull();
    expect(ejecutadas.some(sql => sql.includes('RENAME COLUMN'))).toBe(false);
  });

  it('v19 borra las marcas que dejó v18, que querían decir otra cosa', async () => {
    const { ejecutadas } = mockDb({ aplicadas: hasta('v18_aviso_fotos_inicio_pendientes') });
    await runMigrations();

    expect(ejecutadas.some(sql =>
      sql.includes('SET aviso_sin_iniciar_at = NULL')
    )).toBe(true);
  });

  it('v20 da de alta el flag del mapa de flota APAGADO', async () => {
    // Apagado a propósito: el flag no esconde el mapa al superadmin (no puede,
    // `isFeatureEnabled` y `requireFeature` le dan paso siempre), sino que lo
    // ABRE a los administradores. Ampliar quién ve dónde está cada vehículo
    // tiene que ser un acto deliberado de alguien, no el efecto de aplicar una
    // migración al desplegar.
    const { ejecutadas } = mockDb({ aplicadas: hasta('v19_aviso_sin_iniciar') });
    const { aplicadas, fallida } = await runMigrations();

    expect(fallida).toBeNull();
    expect(aplicadas).toContain('v20_feature_flota');

    const sql = ejecutadas.find(q => q.includes("'menu_flota'"));
    expect(sql).toBeDefined();
    expect(sql).toMatch(/'menu',\s*0,\s*90/);      // enabled = 0
    // INSERT IGNORE: si el superadmin ya lo encendió, reiniciar el backend no
    // puede volver a apagárselo.
    expect(sql).toContain('INSERT IGNORE');
  });

  it('v21 añade material_usado como columna NULL-able', async () => {
    // NULL-able a propósito: lo obligatorio es el momento del cierre, no la
    // fila. Las asignaciones abiertas y las que se cerraron antes de esta
    // migración no tienen material que declarar, y un NOT NULL DEFAULT ''
    // confundiría «no se preguntó» con «no se gastó nada».
    const { ejecutadas } = mockDb({ aplicadas: hasta('v20_feature_flota') });
    const { aplicadas, fallida } = await runMigrations();

    expect(fallida).toBeNull();
    expect(aplicadas).toContain('v21_material_usado');

    const sql = ejecutadas.find(q => q.includes('ADD COLUMN material_usado'));
    expect(sql).toBeDefined();
    expect(sql).toContain('TEXT NULL DEFAULT NULL');
  });

  it('v21 no repite el ALTER si la columna ya existe', async () => {
    const { ejecutadas } = mockDb({
      aplicadas: hasta('v20_feature_flota'),
      columnas:  ['asignaciones_libres.material_usado'],
    });
    await runMigrations();
    expect(ejecutadas.some(q => q.includes('ADD COLUMN material_usado'))).toBe(false);
  });

  it('no resiembra role_permissions si ya tiene filas', async () => {
    const { ejecutadas } = mockDb({ permisosSembrados: 12 });
    await runMigrations();
    expect(ejecutadas.some(sql => sql.includes('INSERT IGNORE INTO role_permissions'))).toBe(false);
  });

  it('no da superadmin al usuario 1 si ese usuario todavía no existe', async () => {
    const { ejecutadas } = mockDb({ existeUser1: false });
    await runMigrations();
    expect(ejecutadas.some(sql => sql.includes('INSERT IGNORE INTO user_roles'))).toBe(false);
  });

  it('añade inicio_real_at cuando v12 está pendiente (el bug del listado)', async () => {
    const { ejecutadas } = mockDb({ aplicadas: hasta('v11_incidencias_asignacion') });
    const { aplicadas, fallida } = await runMigrations();

    expect(fallida).toBeNull();
    // El ledger se quedó en v11: se esperan v12 y todas las posteriores.
    expect(aplicadas).toEqual(TODAS.slice(TODAS.indexOf('v12_inicio_real_at')));
    expect(ejecutadas.some(sql =>
      sql.includes('ALTER TABLE asignaciones_libres') && sql.includes('inicio_real_at')
    )).toBe(true);
  });

  it('no lanza el ALTER si la columna ya existe, pero marca la migración', async () => {
    const { ejecutadas, ledger } = mockDb({
      aplicadas: hasta('v11_incidencias_asignacion'),
      columnas:  ['asignaciones_libres.inicio_real_at'],
    });
    const { fallida } = await runMigrations();

    expect(fallida).toBeNull();
    // Se mira el ADD COLUMN en concreto: sobre asignaciones_libres hay más
    // ALTERs posteriores (v18) y uno de ellos NOMBRA a inicio_real_at en su
    // cláusula AFTER, así que un `includes` a secas lo daría por este.
    expect(ejecutadas.some(sql => sql.includes('ADD COLUMN inicio_real_at'))).toBe(false);
    expect(ledger).toContain('v12_inicio_real_at');
  });

  it('se detiene en la migración fallida y no ejecuta las siguientes', async () => {
    const { ejecutadas, ledger } = mockDb({
      fallarEn: 'CREATE TABLE IF NOT EXISTS app_features',
    });
    const { aplicadas, fallida } = await runMigrations();

    expect(fallida).toBe('v9_app_features');
    // Las anteriores sí se aplicaron: la cadena se corta en la que falla.
    expect(aplicadas).toEqual(hasta('v8_fotos_inicio_fin'));
    expect(ledger).not.toContain('v9_app_features');
    expect(ejecutadas.some(sql => sql.includes('ALTER TABLE asignaciones_libres'))).toBe(false);
  });

  it('informa del fallo si ni siquiera puede crear schema_migrations', async () => {
    mockDb({ fallarEn: 'CREATE TABLE IF NOT EXISTS schema_migrations' });
    const { aplicadas, fallida } = await runMigrations();

    expect(fallida).toBe('schema_migrations');
    expect(aplicadas).toEqual([]);
  });
});

// ============================================================
// v14: deshacer el cruce alias / matrícula
// ============================================================
// El cliente dio de alta la flota escribiendo el nombre de la ambulancia en
// `matricula` y la matrícula en `alias`. La migración lo intercambia, pero
// solo cuando no hay ambigüedad: equivocarse aquí deja un vehículo sin
// identificar en todo el historial.
describe('descruce de la flota (v14 / v15)', () => {
  const v15 = MIGRATIONS.find(m => m.name === 'v15_descruzar_vehiculos_restantes');

  /**
   * Prepara el runner con una flota concreta y devuelve los UPDATE finales
   * (los de la segunda pasada, ya con el valor definitivo).
   */
  function mockFlota(vehiculos) {
    const escrituras = [];

    query.mockReset();
    query.mockImplementation(async (sql, params = []) => {
      if (sql.includes('FROM vehicles')) return [vehiculos];
      if (sql.startsWith('SELECT name FROM schema_migrations')) return [[]];
      return [[]];
    });

    transaction.mockReset();
    transaction.mockImplementation(async (cb) => cb({
      execute: async (sql, params) => {
        escrituras.push({ sql, params });
        return [{ affectedRows: 1 }];
      },
    }));

    // Solo interesan los valores definitivos, no los placeholders __V14__.
    const finales = () => escrituras
      .filter(e => e.sql.includes('alias = ?'))
      .map(e => ({ matricula: e.params[0], alias: e.params[1], id: e.params[2] }));

    return { escrituras, finales };
  }

  it('intercambia los campos cuando el alias es la matrícula y la matrícula no', async () => {
    const { finales } = mockFlota([
      { id: 7, matricula: 'Ambulancia 1', alias: '1234BCD', deleted_at: null },
    ]);
    await v15.run();

    expect(finales()).toEqual([{ id: 7, matricula: '1234BCD', alias: 'Ambulancia 1' }]);
  });

  it('libera la matrícula en una primera pasada para no chocar con uq_matricula', async () => {
    const { escrituras } = mockFlota([
      { id: 7, matricula: 'Ambulancia 1', alias: '1234BCD', deleted_at: null },
    ]);
    await v15.run();

    expect(escrituras[0].params[0]).toBe('__SWAP__7');
    expect(escrituras[1].params[0]).toBe('1234BCD');
  });

  it('normaliza la matrícula aunque la fila no esté cruzada', async () => {
    const { finales } = mockFlota([
      { id: 3, matricula: '1234 bcd', alias: 'Ambulancia 3', deleted_at: null },
    ]);
    await v15.run();

    expect(finales()).toEqual([{ id: 3, matricula: '1234BCD', alias: 'Ambulancia 3' }]);
  });

  it('no toca las filas ya correctas', async () => {
    const { escrituras } = mockFlota([
      { id: 1, matricula: '1234BCD', alias: 'Ambulancia 1', deleted_at: null },
      { id: 2, matricula: 'M1234AB', alias: 'Ambulancia 2', deleted_at: null },
    ]);
    await v15.run();

    expect(escrituras).toEqual([]);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('deja intacta la fila ambigua: ninguno de los dos parece una matrícula', async () => {
    const { escrituras } = mockFlota([
      { id: 5, matricula: 'UVI Movil', alias: 'Ambulancia 5', deleted_at: null },
    ]);
    await v15.run();

    expect(escrituras).toEqual([]);
  });

  // Caso real de producción: el vehículo 1 se borró (el borrado lógico le pone
  // el sufijo __del_<id> para liberar la matrícula) y el 11 seguía cruzado. Si
  // la fila borrada cuenta como candidata, las dos aspiran a 8588KZY y ninguna
  // se corrige, que es lo que pasó con v14.
  it('una fila borrada no bloquea el descruce de la viva', async () => {
    const { finales } = mockFlota([
      { id: 1,  matricula: '8588KCY__del_1', alias: '8588-KZY', deleted_at: '2026-09-03 08:46:04' },
      { id: 11, matricula: 'SVB-01',         alias: '8588-KZY', deleted_at: null },
    ]);
    await v15.run();

    expect(finales()).toEqual([{ id: 11, matricula: '8588KZY', alias: 'SVB-01' }]);
  });

  it('no reescribe la matrícula sufijada de una fila borrada', async () => {
    const { escrituras } = mockFlota([
      { id: 1, matricula: '8095KYG__del_1', alias: 'UVI-01', deleted_at: '2026-09-03 08:47:04' },
    ]);
    await v15.run();

    expect(escrituras).toEqual([]);
  });

  // uq_matricula cubre también las filas borradas: si una de ellas ocupa ya la
  // matrícula canónica, la viva no puede tomarla.
  it('respeta la matrícula que ya ocupa una fila borrada sin sufijo', async () => {
    const { escrituras } = mockFlota([
      { id: 1, matricula: '1234BCD',      alias: 'Antigua',      deleted_at: '2026-09-03 08:46:04' },
      { id: 2, matricula: 'Ambulancia 2', alias: '1234-BCD',     deleted_at: null },
    ]);
    await v15.run();

    expect(escrituras).toEqual([]);
  });

  it('no aplica un intercambio que dejaría dos vehículos con la misma matrícula', async () => {
    const { escrituras } = mockFlota([
      { id: 1, matricula: 'Ambulancia 1', alias: '1234BCD', deleted_at: null },
      { id: 2, matricula: 'Ambulancia 2', alias: '1234-BCD', deleted_at: null },
    ]);
    await v15.run();

    expect(escrituras).toEqual([]);
  });
});

// ============================================================
// v16 — horas escritas en hora española que hay que pasar a UTC
// ============================================================
describe('v16_horas_a_utc', () => {
  const v16 = MIGRATIONS.find(m => m.name === 'v16_horas_a_utc');

  /** Un DATETIME tal y como lo devuelve mysql2: el literal, en campos UTC. */
  const literal = (s) => new Date(`${s}Z`);

  it('reinterpreta como española la hora guardada y la reescribe en UTC', async () => {
    const { updates } = mockDb({
      aplicadas: hasta('v15_descruzar_vehiculos_restantes'),
      tablas:    ['asignaciones_libres'],
      columnas:  ['asignaciones_libres.inicio_real_at', 'asignaciones_libres.finalizado_at'],
      filas: {
        asignaciones_libres: [{
          id: 7,
          inicio_real_at: literal('2026-09-18 20:08:28'),  // verano, +02:00
          finalizado_at:  literal('2026-09-18 20:09:56'),
        }],
      },
    });
    await runMigrations();

    const [{ sql, params }] = updates;
    expect(sql).toContain('UPDATE asignaciones_libres');
    expect(params[0].toISOString()).toBe('2026-09-18T18:08:28.000Z');
    expect(params[1].toISOString()).toBe('2026-09-18T18:09:56.000Z');
    expect(params[2]).toBe(7);
  });

  it('descuenta solo una hora en invierno', async () => {
    const { updates } = mockDb({
      aplicadas: hasta('v15_descruzar_vehiculos_restantes'),
      tablas:    ['audit_logs'],
      columnas:  ['audit_logs.created_at'],
      filas: { audit_logs: [{ id: 3, created_at: literal('2026-12-01 09:30:00') }] },
    });
    await runMigrations();

    expect(updates[0].params[0].toISOString()).toBe('2026-12-01T08:30:00.000Z');
  });

  it('no toca nada si la tabla no existe en esta base de datos', async () => {
    const { updates, ledger } = mockDb({
      aplicadas: hasta('v15_descruzar_vehiculos_restantes'),
    });
    const { fallida } = await runMigrations();

    expect(fallida).toBeNull();
    expect(reescrituras(updates)).toEqual([]);
    expect(ledger).toContain('v16_horas_a_utc');
  });

  it('respeta los NULL de las columnas opcionales', async () => {
    const { updates } = mockDb({
      aplicadas: hasta('v15_descruzar_vehiculos_restantes'),
      tablas:    ['asignaciones_libres'],
      columnas:  ['asignaciones_libres.inicio_real_at', 'asignaciones_libres.finalizado_at'],
      filas: {
        asignaciones_libres: [{
          id: 6,
          inicio_real_at: literal('2026-09-18 11:46:38'),
          finalizado_at:  null,   // asignación todavía abierta
        }],
      },
    });
    await runMigrations();

    const { sql, params } = updates[0];
    expect(sql).toContain('inicio_real_at = ?');
    expect(sql).not.toContain('finalizado_at');   // un NULL ni se lee ni se escribe
    expect(params[0].toISOString()).toBe('2026-09-18T09:46:38.000Z');
    expect(params[1]).toBe(6);
  });
});

// El caso que se escapaba: la fila entra porque UNA de sus columnas está por
// encima del corte, pero las demás pueden estar ya bien y no hay que tocarlas.
describe('v16_horas_a_utc · filas a caballo del corte', () => {
  const literal = (s) => new Date(`${s}Z`);

  it('corrige solo la columna que está por encima del corte', async () => {
    const { updates } = mockDb({
      aplicadas: hasta('v15_descruzar_vehiculos_restantes'),
      tablas:    ['asignaciones_libres'],
      columnas:  ['asignaciones_libres.inicio_real_at', 'asignaciones_libres.finalizado_at'],
      filas: {
        asignaciones_libres: [{
          id: 9,
          inicio_real_at: literal('2026-08-20 09:00:00'),  // anterior al corte: ya está en UTC
          finalizado_at:  literal('2026-08-26 09:00:00'),  // posterior: escrito en hora española
        }],
      },
    });
    await runMigrations();

    expect(reescrituras(updates)).toHaveLength(1);
    const { sql, params } = updates[0];
    expect(sql).toContain('finalizado_at = ?');
    expect(sql).not.toContain('inicio_real_at');          // no se toca la que ya estaba bien
    expect(params[0].toISOString()).toBe('2026-08-26T07:00:00.000Z');
    expect(params[1]).toBe(9);
  });

  it('no escribe nada si todas las columnas de la fila son anteriores al corte', async () => {
    const { updates } = mockDb({
      aplicadas: hasta('v15_descruzar_vehiculos_restantes'),
      tablas:    ['asignaciones_libres'],
      columnas:  ['asignaciones_libres.inicio_real_at', 'asignaciones_libres.finalizado_at'],
      filas: {
        asignaciones_libres: [{
          id: 10,
          inicio_real_at: literal('2026-08-20 09:00:00'),
          finalizado_at:  literal('2026-08-20 10:00:00'),
        }],
      },
    });
    await runMigrations();

    expect(reescrituras(updates)).toEqual([]);
  });

  it('congela updated_at para que el ON UPDATE no lo pise con la hora actual', async () => {
    const { updates } = mockDb({
      aplicadas: hasta('v15_descruzar_vehiculos_restantes'),
      tablas:    ['vehicle_incidencias'],
      columnas:  [
        'vehicle_incidencias.created_at',
        'vehicle_incidencias.updated_at',
        'vehicle_incidencias.resuelto_at',
      ],
      autoActualizan: ['vehicle_incidencias.updated_at'],
      filas: {
        vehicle_incidencias: [{
          id: 4,
          created_at:  literal('2026-08-20 09:00:00'),   // anterior al corte
          updated_at:  literal('2026-08-20 09:00:00'),   // anterior al corte
          resuelto_at: literal('2026-09-10 12:00:00'),   // posterior
        }],
      },
    });
    await runMigrations();

    const { sql, params } = updates[0];
    expect(sql).toContain('resuelto_at = ?');
    expect(sql).toContain('updated_at = ?');              // va en el SET aunque no cambie
    expect(sql).not.toContain('created_at');
    expect(params[0].toISOString()).toBe('2026-09-10T10:00:00.000Z');  // resuelto_at corregido
    expect(params[1].toISOString()).toBe('2026-08-20T09:00:00.000Z');  // updated_at, tal cual
    expect(params[2]).toBe(4);
  });

  it('v22 da de alta el rol tes_conductor y no le siembra ningun permiso', async () => {
    // El rol entra por migracion, y no creandolo a mano desde /usuarios, para
    // que se llame igual en local, PRE y produccion: `tieneRolDeCampo` lo
    // busca por nombre. Y entra pelado: si apareciera en el reparto de v4, un
    // TES conductor se encontraria con la gestion abierta.
    const { ejecutadas } = mockDb();
    const { fallida } = await runMigrations();

    expect(fallida).toBeNull();
    const alta = ejecutadas.find(q =>
      q.includes('INSERT IGNORE INTO roles') && q.includes('tes_conductor'));
    expect(alta).toBeDefined();
    expect(ejecutadas.some(q =>
      q.includes('role_permissions') && q.includes('tes_conductor'))).toBe(false);
  });

  it('v23 crea asignacion_usuarios con la persona unica por asignacion y rellena los responsables', async () => {
    // La clave primaria (asignacion_id, user_id) es la que impide repetir a
    // alguien, tambien como responsable y personal a la vez. Y el relleno
    // conserva al usuario de cada asignacion existente como responsable.
    const { ejecutadas } = mockDb({ aplicadas: hasta('v22_rol_tes_conductor') });
    const { aplicadas, fallida } = await runMigrations();

    expect(fallida).toBeNull();
    expect(aplicadas).toEqual(['v23_asignacion_usuarios']);

    const tabla = ejecutadas.find(q => q.includes('CREATE TABLE IF NOT EXISTS asignacion_usuarios'));
    expect(tabla).toContain('PRIMARY KEY (asignacion_id, user_id)');
    expect(tabla).toContain("ENUM('responsable','personal')");
    expect(tabla).toContain('ON DELETE CASCADE');

    const relleno = ejecutadas.find(q => q.includes('INSERT IGNORE INTO asignacion_usuarios'));
    expect(relleno).toContain("'responsable'");
    expect(relleno).toContain('FROM asignaciones_libres');
  });
});
