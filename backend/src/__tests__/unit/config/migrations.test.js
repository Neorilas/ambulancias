'use strict';

const { query } = require('../../../config/database');
const { runMigrations, MIGRATIONS } = require('../../../config/migrations');

const TODAS = MIGRATIONS.map(m => m.name);

/** Todas las migraciones hasta `nombre` incluido, en el orden real del runner. */
function hasta(nombre) {
  return TODAS.slice(0, TODAS.indexOf(nombre) + 1);
}

/**
 * Simula la BD para el runner.
 * @param {string[]} aplicadas  nombres ya presentes en schema_migrations
 * @param {string[]} columnas   columnas existentes, en formato "tabla.columna"
 * @param {string[]} indices    índices existentes, en formato "tabla.indice"
 * @param {number}   permisosSembrados  filas en role_permissions
 * @param {boolean}  existeUser1 si users tiene el id 1
 * @param {string}   fallarEn   fragmento de SQL que debe lanzar error
 */
function mockDb({
  aplicadas = [], columnas = [], indices = [],
  permisosSembrados = 0, existeUser1 = false, fallarEn = null,
} = {}) {
  const ejecutadas = [];
  const ledger     = [...aplicadas];

  // clearAllMocks no drena las colas de mockResolvedValueOnce: reset explícito
  query.mockReset();
  query.mockImplementation(async (sql, params = []) => {
    ejecutadas.push(sql);

    if (fallarEn && sql.includes(fallarEn)) throw new Error('fallo SQL simulado');

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

  return { ejecutadas, ledger };
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
    expect(aplicadas).toEqual(['v12_inicio_real_at', 'v13_incidencia_comentarios']);
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
    expect(ejecutadas.some(sql => sql.includes('ALTER TABLE asignaciones_libres'))).toBe(false);
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
