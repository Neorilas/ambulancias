'use strict';

const { query } = require('../../../config/database');
const { runMigrations, MIGRATIONS } = require('../../../config/migrations');

const TODAS = MIGRATIONS.map(m => m.name);

/**
 * Simula la BD para el runner.
 * @param {string[]} aplicadas  nombres ya presentes en schema_migrations
 * @param {string[]} columnas   columnas existentes, en formato "tabla.columna"
 * @param {string}   fallarEn   fragmento de SQL que debe lanzar error
 */
function mockDb({ aplicadas = [], columnas = [], fallarEn = null } = {}) {
  const ejecutadas = [];
  const ledger     = [...aplicadas];

  // clearAllMocks no drena las colas de mockResolvedValueOnce: reset explícito
  query.mockReset();
  query.mockImplementation(async (sql, params = []) => {
    ejecutadas.push(sql);

    if (fallarEn && sql.includes(fallarEn)) throw new Error('fallo SQL simulado');

    if (sql.includes('information_schema.COLUMNS')) {
      const [tabla, columna] = params;
      return [[{ c: columnas.includes(`${tabla}.${columna}`) ? 1 : 0 }]];
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

  it('añade inicio_real_at cuando v12 está pendiente (el bug del listado)', async () => {
    const { ejecutadas } = mockDb({
      aplicadas: ['v9_app_features', 'v10_baseline_vehiculos', 'v11_incidencias_asignacion'],
    });
    const { aplicadas, fallida } = await runMigrations();

    expect(fallida).toBeNull();
    expect(aplicadas).toEqual(['v12_inicio_real_at']);
    expect(ejecutadas.some(sql =>
      sql.includes('ALTER TABLE asignaciones_libres') && sql.includes('inicio_real_at')
    )).toBe(true);
  });

  it('no lanza el ALTER si la columna ya existe, pero marca la migración', async () => {
    const { ejecutadas, ledger } = mockDb({
      aplicadas: ['v9_app_features', 'v10_baseline_vehiculos', 'v11_incidencias_asignacion'],
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
    expect(aplicadas).toEqual([]);
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
