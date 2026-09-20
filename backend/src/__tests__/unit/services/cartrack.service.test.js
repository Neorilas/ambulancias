'use strict';

/**
 * Tests de services/cartrack.service.js
 *
 * `fetch` va mockeado: de aquí no sale ni una petición a Cartrack. Lo que se
 * fija es lo que este módulo promete al resto de la app:
 *   - que NUNCA lanza, pase lo que pase al otro lado;
 *   - que la caché compartida deja las llamadas muy por debajo del límite de
 *     60/min, incluso con varios admins mirando el mapa a la vez;
 *   - que un fallo puntual no vacía la pantalla, pero un fallo largo sí.
 *
 * Ojo con el orden de carga: el módulo lee las credenciales y los tiempos del
 * entorno AL IMPORTARSE, y además guarda la caché en una variable de módulo.
 * Por eso cada bloque llama a `cargar()`, que hace `jest.resetModules()` antes
 * del `require`; un require en la cabecera del fichero compartiría la caché
 * entre todos los tests.
 */

const USUARIO = 'VAPS00001';
const CLAVE   = 'clave-de-prueba';

let servicio;

/** Carga el módulo con el entorno que pida cada test. */
function cargar({ credenciales = true, env = {} } = {}) {
  jest.resetModules();
  if (credenciales) {
    process.env.CARTRACK_USER = USUARIO;
    process.env.CARTRACK_KEY  = CLAVE;
  } else {
    delete process.env.CARTRACK_USER;
    delete process.env.CARTRACK_KEY;
  }
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  servicio = require('../../../services/cartrack.service');
  return servicio;
}

/** Respuesta OK de fetch con este cuerpo. */
function respuesta(cuerpo, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  };
}

/**
 * Fila REAL, copiada de lo que devolvió la sonda de fase 0 contra la cuenta de
 * verdad el 2026-09-20. Se deja tal cual (nombres de campo, `registration` con
 * el nombre del vehículo pegado, odómetro en metros) para que estos tests
 * hablen de la API que hay, no de la que imaginamos leyendo el OpenAPI.
 */
const FILA = {
  vehicle_id: 454742160,
  registration: 'UVI-3-7740MZB',
  location: {
    latitude: 40.091935, longitude: -3.12295,
    position_description: 'Autovía del Este, Fuentidueña de Tajo, 28597, Madrid, Spain',
  },
  speed: 114,
  bearing: 311,
  ignition: true,
  idling: false,
  odometer: 47796000,           // metros: así llega si no se pide `odometer_in_km`
  event_ts: '2026-09-20 16:35:56+02',
  driver: { driver_id: 'aeadebab', first_name: 'UVI-3', last_name: 'EXTRAS', phone_number: null },
  fuel: { level: 62 },
};

beforeEach(() => {
  jest.useRealTimers();
  global.fetch = jest.fn();
  delete process.env.CARTRACK_CACHE_MS;
  delete process.env.CARTRACK_TIMEOUT_MS;
});

afterEach(() => {
  delete global.fetch;
});

// ============================================================
describe('estaConfigurado', () => {
  it('sin credenciales queda inerte y no llama a nadie', async () => {
    const s = cargar({ credenciales: false });
    expect(s.estaConfigurado()).toBe(false);

    const res = await s.obtenerEstados();
    expect(res).toEqual({
      vehiculos: [], origen: 'ninguno', actualizado: null, error: null, configurado: false,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('con credenciales se da por configurado', () => {
    expect(cargar().estaConfigurado()).toBe(true);
  });
});

// ============================================================
describe('normalizarVehiculo', () => {
  it('traduce la fila real de Cartrack a la forma que entiende la app', () => {
    const v = cargar().normalizarVehiculo(FILA);
    expect(v).toMatchObject({
      cartrackId: 454742160,
      matricula: '7740MZB',                 // SACADA de 'UVI-3-7740MZB'
      matriculaOriginal: 'UVI-3-7740MZB',
      lat: 40.091935,
      lng: -3.12295,
      velocidad: 114,
      contacto: true,
      conductor: 'UVI-3 EXTRAS',
    });
    expect(v.ubicacion).toContain('Fuentidueña de Tajo');
    // `event_ts` no viene en ISO ('2026-09-20 16:35:56+02'), pero trae su
    // desfase horario: se guarda en UTC como todo lo demás.
    expect(v.actualizado).toBe('2026-09-20T14:35:56.000Z');
  });

  it('saca la matrícula del nombre con el que Cartrack bautiza el vehículo', () => {
    // ESTE es el fallo que cazó la sonda: `registration` no es la matrícula,
    // es nombre + matrícula. Normalizando el texto entero cruzaban 0 de 10.
    const s = cargar();
    const casos = [
      ['UVI-3-7740MZB',  '7740MZB'],
      ['UVI-2-4669LTT',  '4669LTT'],
      ['VAL- 2066JSC',   '2066JSC'],   // con espacio detrás del guion
      ['VIR-01-7950KGG', '7950KGG'],
      ['SVB-01-8588KCY', '8588KCY'],
      ['1234 BCD',       '1234BCD'],   // y una matrícula a secas sigue valiendo
    ];
    for (const [entrada, esperada] of casos) {
      expect(s.normalizarVehiculo({ registration: entrada }).matricula).toBe(esperada);
    }
  });

  it('el conductor sale como TEXTO, nunca como el objeto de Cartrack', () => {
    // `driver` es un objeto en la respuesta real. Devolverlo tal cual metía
    // `{driver_id, first_name, ...}` en el campo y React revienta al pintarlo.
    const s = cargar();
    expect(s.normalizarVehiculo(FILA).conductor).toBe('UVI-3 EXTRAS');
    expect(s.normalizarVehiculo({ driver: { first_name: 'Ana' } }).conductor).toBe('Ana');
    expect(s.normalizarVehiculo({ driver: { driver_id: 'x', first_name: null, last_name: null } }).conductor).toBeNull();
    expect(s.normalizarVehiculo({ driver_name: 'Luis Gil' }).conductor).toBe('Luis Gil');
    expect(s.normalizarVehiculo({}).conductor).toBeNull();
  });

  it('el odómetro sale SIEMPRE en kilómetros, y un kilometraje normal no se toca', () => {
    const s = cargar();
    // 235.400 km es lo que tiene una ambulancia con unos años: si la red de
    // seguridad lo dividiera, la ficha diría 235 km. Solo se divide lo que no
    // puede ser km de ningún vehículo real.
    expect(s.normalizarVehiculo({ odometer: 235400 }).odometroKm).toBe(235400);
    expect(s.normalizarVehiculo({ odometer: 235400000 }).odometroKm).toBe(235400);
    expect(s.normalizarVehiculo({}).odometroKm).toBeNull();
  });

  it('pide los kilómetros a Cartrack en vez de adivinar la unidad', async () => {
    const s = cargar();
    global.fetch.mockResolvedValue(respuesta([]));
    await s.obtenerEstados();
    expect(global.fetch.mock.calls[0][0]).toContain('odometer_in_km=true');
  });

  it('acepta los alias razonables de cada campo', () => {
    // Los nombres no se han confirmado contra la cuenta real (fase 0), así que
    // el módulo lee varias rutas posibles antes de rendirse.
    const v = cargar().normalizarVehiculo({
      id: 'x1', plate: '5555FFF', latitude: '41.1', longitude: '1.2',
      speed_kmh: '30', ignition_on: 'ON', driver_name: 'Luis',
    });
    expect(v).toMatchObject({
      cartrackId: 'x1', matricula: '5555FFF', lat: 41.1, lng: 1.2,
      velocidad: 30, contacto: true, conductor: 'Luis',
    });

  });

  it('distingue «contacto apagado» de «no lo sabemos»', () => {
    const s = cargar();
    expect(s.normalizarVehiculo({ ignition: false }).contacto).toBe(false);
    expect(s.normalizarVehiculo({ ignition: 'no' }).contacto).toBe(false);
    expect(s.normalizarVehiculo({}).contacto).toBeNull();
    expect(s.normalizarVehiculo({ ignition: 'quizá' }).contacto).toBeNull();
  });

  it('una fecha imposible se descarta en vez de colarse como Invalid Date', () => {
    expect(cargar().normalizarVehiculo({ event_ts: 'ayer' }).actualizado).toBeNull();
  });
});

// ============================================================
describe('extraerLista', () => {
  it('acepta el array pelado y los envoltorios habituales', () => {
    const s = cargar();
    expect(s.extraerLista([FILA])).toHaveLength(1);
    expect(s.extraerLista({ data: [FILA] })).toHaveLength(1);
    expect(s.extraerLista({ vehicles: [FILA] })).toHaveLength(1);
    expect(s.extraerLista({ raro: 1 })).toEqual([]);
    expect(s.extraerLista(null)).toEqual([]);
  });
});

// ============================================================
describe('obtenerEstados', () => {
  it('llama con Basic auth a la URL de España y devuelve la flota', async () => {
    const s = cargar();
    global.fetch.mockResolvedValue(respuesta({ data: [FILA] }));

    const res = await s.obtenerEstados();

    expect(res.origen).toBe('api');
    expect(res.error).toBeNull();
    expect(res.vehiculos).toHaveLength(1);
    expect(res.vehiculos[0].matricula).toBe('7740MZB');

    const [url, opciones] = global.fetch.mock.calls[0];
    expect(url).toBe('https://fleetapi-es.cartrack.com/rest/vehicles/status?odometer_in_km=true');
    expect(opciones.headers.Authorization)
      .toBe('Basic ' + Buffer.from(`${USUARIO}:${CLAVE}`).toString('base64'));
  });

  it('la segunda consulta seguida sale de la caché, sin llamar otra vez', async () => {
    const s = cargar();
    global.fetch.mockResolvedValue(respuesta([FILA]));

    await s.obtenerEstados();
    const segunda = await s.obtenerEstados();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(segunda.origen).toBe('cache');
    expect(segunda.vehiculos).toHaveLength(1);
  });

  it('varios admins a la vez comparten UNA sola llamada', async () => {
    // Es el motivo de ser del single-flight: sin él, tres pestañas abriendo el
    // mapa al caducar la caché harían tres llamadas para el mismo dato, y el
    // límite de Cartrack es de la cuenta, no de cada usuario.
    const s = cargar();
    let resolver;
    global.fetch.mockReturnValue(new Promise((r) => { resolver = r; }));

    const peticiones = Promise.all([s.obtenerEstados(), s.obtenerEstados(), s.obtenerEstados()]);
    resolver(respuesta([FILA]));
    const [a, b, c] = await peticiones;

    expect(global.fetch).toHaveBeenCalledTimes(1);
    for (const r of [a, b, c]) expect(r.vehiculos).toHaveLength(1);
  });

  it('pasada la vida de la caché vuelve a preguntar', async () => {
    const s = cargar({ env: { CARTRACK_CACHE_MS: '10' } });
    global.fetch.mockResolvedValue(respuesta([FILA]));

    await s.obtenerEstados();
    await new Promise(r => setTimeout(r, 25));
    await s.obtenerEstados();

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('un fallo de Cartrack no vacía el mapa: sirve la última foto conocida', async () => {
    const s = cargar({ env: { CARTRACK_CACHE_MS: '10' } });
    global.fetch.mockResolvedValueOnce(respuesta([FILA]));
    await s.obtenerEstados();

    await new Promise(r => setTimeout(r, 25));
    global.fetch.mockRejectedValue(new Error('ECONNRESET'));
    const res = await s.obtenerEstados();

    expect(res.origen).toBe('cache-vieja');
    expect(res.vehiculos).toHaveLength(1);
    expect(res.error).toContain('ECONNRESET');   // la pantalla lo cuenta
  });

  it('sin nada en caché y con Cartrack caído devuelve lista vacía y el motivo', async () => {
    const s = cargar();
    global.fetch.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    const res = await s.obtenerEstados();
    expect(res).toMatchObject({ vehiculos: [], origen: 'ninguno', configurado: true });
    expect(res.error).toContain('ENOTFOUND');
  });

  it('un 401 se explica apuntando a la región, que es lo que suele fallar', async () => {
    const s = cargar();
    global.fetch.mockResolvedValue(respuesta({}, { ok: false, status: 401 }));

    const res = await s.obtenerEstados();
    expect(res.error).toMatch(/credenciales rechazadas/);
    expect(res.error).toMatch(/España/);
  });

  it('un 429 se nombra como lo que es', async () => {
    const s = cargar();
    global.fetch.mockResolvedValue(respuesta({}, { ok: false, status: 429 }));

    const res = await s.obtenerEstados();
    expect(res.error).toMatch(/límite de llamadas/);
  });

  it('un timeout se cuenta como tal, no como un error críptico', async () => {
    const s = cargar({ env: { CARTRACK_TIMEOUT_MS: '50' } });
    const err = new Error('The operation was aborted');
    err.name = 'TimeoutError';
    global.fetch.mockRejectedValue(err);

    const res = await s.obtenerEstados();
    expect(res.error).toMatch(/no respondió en 50 ms/);
  });

  it('nunca lanza, ni con una respuesta que no es JSON', async () => {
    const s = cargar();
    global.fetch.mockResolvedValue({
      ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); },
    });

    await expect(s.obtenerEstados()).resolves.toMatchObject({ origen: 'ninguno' });
  });

  it('respeta CARTRACK_BASE_URL y le quita la barra final', async () => {
    const s = cargar({ env: { CARTRACK_BASE_URL: 'https://fleetapi-za.cartrack.com/rest/' } });
    global.fetch.mockResolvedValue(respuesta([]));

    await s.obtenerEstados();
    expect(global.fetch.mock.calls[0][0])
      .toBe('https://fleetapi-za.cartrack.com/rest/vehicles/status?odometer_in_km=true');
    delete process.env.CARTRACK_BASE_URL;
  });
});
