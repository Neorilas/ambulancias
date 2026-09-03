'use strict';

const { query, transaction } = require('../../../config/database');
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
