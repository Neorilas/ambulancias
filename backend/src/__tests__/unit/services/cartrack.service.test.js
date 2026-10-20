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

// ============================================================
describe('obtenerRecorrido', () => {
  /** Evento REAL de /vehicles/events (sonda, 2026-10-19), recortado. */
  const evento = (over = {}) => ({
    vehicle_id: 454742160, registration: 'UVI-3-7740MZB',
    latitude: 40.317759, longitude: -3.681321, speed: 0,
    event_ts: '2026-10-19 10:24:19+02', event_description: 'PERIODIC_EVENT',
    ...over,
  });
  const ventana = { cartrackId: 454742160, registration: 'UVI-3-7740MZB',
    desde: new Date('2026-10-19T08:00:00Z'), hasta: new Date('2026-10-19T10:00:00Z') };

  it('`event_ts` llega con la zona sin minutos (+02) y se lee bien', () => {
    expect(cargar().instanteDeEvento('2026-10-19 10:24:19+02')).toBe(Date.parse('2026-10-19T08:24:19Z'));
  });

  it('pide por `registration` (vehicle_id no filtra) y con la ventana en hora de España', async () => {
    const s = cargar();
    global.fetch.mockResolvedValueOnce(respuesta({ data: [evento()], meta: { last_page: 1 } }));
    const r = await s.obtenerRecorrido(ventana);
    const url = new URL(global.fetch.mock.calls[0][0]);
    expect(url.pathname).toMatch(/\/vehicles\/events$/);
    expect(url.searchParams.get('registration')).toBe('UVI-3-7740MZB');
    expect(url.searchParams.has('vehicle_id')).toBe(false);
    // Se pide el día entero (caché por días) y se recorta a la ventana
    expect(url.searchParams.get('start_timestamp')).toBe('2026-10-19 00:00:00');
    expect(r.puntos).toHaveLength(1);
  });

  it('descarta eventos de otra ambulancia aunque la API los cuele', async () => {
    const s = cargar();
    global.fetch.mockResolvedValueOnce(respuesta({ data: [
      evento(), evento({ vehicle_id: 454742170, registration: 'UVI-5-1071NBV' }),
    ], meta: { last_page: 1 } }));
    expect((await s.obtenerRecorrido(ventana)).puntos).toHaveLength(1);
  });

  it('sigue las páginas y parte en tramos de 24 h', async () => {
    const s = cargar();
    global.fetch
      .mockResolvedValueOnce(respuesta({ data: [evento()], meta: { last_page: 2 } }))
      .mockResolvedValueOnce(respuesta({ data: [evento({ event_ts: '2026-10-19 11:00:00+02' })], meta: { last_page: 2 } }))
      .mockResolvedValueOnce(respuesta({ data: [], meta: { last_page: 1 } }));
    const r = await s.obtenerRecorrido({ ...ventana, hasta: new Date('2026-10-20T10:00:00Z') });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(r.puntos).toHaveLength(2);
  });

  it('una ventana cerrada se sirve de caché la segunda vez', async () => {
    const s = cargar();
    global.fetch.mockResolvedValueOnce(respuesta({ data: [evento()], meta: { last_page: 1 } }));
    await s.obtenerRecorrido(ventana);
    await s.obtenerRecorrido(ventana);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('dos peticiones a la vez de lo mismo hacen UNA llamada (single-flight)', async () => {
    const s = cargar();
    global.fetch.mockResolvedValueOnce(respuesta({ data: [evento()], meta: { last_page: 1 } }));
    const [a, b] = await Promise.all([s.obtenerRecorrido(ventana), s.obtenerRecorrido(ventana)]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(a.puntos).toHaveLength(1);
    expect(b.puntos).toHaveLength(1);
  });

  it('nunca lanza: Cartrack caído → sin puntos y con el error', async () => {
    const s = cargar();
    global.fetch.mockResolvedValueOnce(respuesta({}, { ok: false, status: 500 }));
    const r = await s.obtenerRecorrido(ventana);
    expect(r).toMatchObject({ puntos: [], configurado: true });
    expect(r.error).toMatch(/500/);
  });

  it('sin credenciales no llama a nadie', async () => {
    const s = cargar({ credenciales: false });
    expect(await s.obtenerRecorrido(ventana)).toEqual({ puntos: [], error: null, configurado: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ============================================================
describe('obtenerRecorrido — caché por días', () => {
  const { instanteEnEspana } = require('../../../utils/fecha.utils');
  const H = 3600 * 1000;
  const MIN = 60 * 1000;
  const REG = 'UVI-3-7740MZB';
  const base = { cartrackId: 454742160, registration: REG };

  /** Instantes (ms) de los eventos que «tiene» el Cartrack falso. */
  let eventos;

  /** 'YYYY-MM-DD HH:MM:SS' en hora de España → instante, como lo lee la API. */
  function deHoraEspana(txt) {
    const [f, h] = txt.split(' ');
    const [a, m, d] = f.split('-').map(Number);
    const [hh, mi, ss] = h.split(':').map(Number);
    return instanteEnEspana(a, m, d, hh, mi, ss).getTime();
  }

  /** Eventos cada `paso` ms entre dos instantes, ambos incluidos. */
  function cada(paso, desde, hasta) {
    const lista = [];
    for (let t = desde; t <= hasta; t += paso) lista.push(t);
    return lista;
  }

  /**
   * Cartrack falso: devuelve los eventos de la ventana pedida con los DOS
   * extremos incluidos (así se ve si un segundo frontera sale repetido). El
   * `event_ts` va en UTC ('+00'), que `instanteDeEvento` también lee.
   */
  function cartrackFalso() {
    global.fetch.mockImplementation(async (url) => {
      const q = new URL(url).searchParams;
      const ini = deHoraEspana(q.get('start_timestamp'));
      const fin = deHoraEspana(q.get('end_timestamp'));
      const data = eventos.filter(t => t >= ini && t <= fin).map(t => ({
        vehicle_id: 454742160, registration: REG, latitude: 40.3, longitude: -3.6, speed: 50,
        event_ts: `${new Date(t).toISOString().slice(0, 19).replace('T', ' ')}+00`,
      }));
      return respuesta({ data, meta: { last_page: 1 } });
    });
  }

  /** Reloj falso en `iso`; las promesas siguen siendo de verdad. */
  function relojEn(iso) {
    jest.useFakeTimers({ now: new Date(iso), doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  }

  const inicios = () => global.fetch.mock.calls.map(c => new URL(c[0]).searchParams.get('start_timestamp'));

  afterEach(() => { jest.useRealTimers(); });

  it('servicio en curso de más de 7 días: la primera vez pide cada día; el refresco, solo hoy', async () => {
    relojEn('2026-10-20T10:00:00Z'); // 12:00 en España
    const s = cargar();
    eventos = cada(10 * MIN, Date.parse('2026-10-12T00:00:00Z'), Date.parse('2026-10-20T12:00:00Z'));
    cartrackFalso();

    // Como el controlador: `desde` = ahora − 7 d, `hasta` = ahora
    const pedir = () => {
      const ahora = Date.now();
      return s.obtenerRecorrido({ ...base, desde: new Date(ahora - 7 * 24 * H), hasta: new Date(ahora) });
    };

    const r1 = await pedir();
    // Del 13 al 20 de octubre: 8 días, una llamada por día
    expect(global.fetch).toHaveBeenCalledTimes(8);
    expect(inicios()[0]).toBe('2026-10-13 00:00:00');
    expect(r1.error).toBeNull();

    // Dentro del minuto, nada
    jest.setSystemTime(new Date('2026-10-20T10:00:30Z'));
    await pedir();
    expect(global.fetch).toHaveBeenCalledTimes(8);

    // Pasado el minuto: UNA llamada, la de hoy
    jest.setSystemTime(new Date('2026-10-20T10:01:30Z'));
    const r2 = await pedir();
    expect(global.fetch).toHaveBeenCalledTimes(9);
    expect(inicios()[8]).toBe('2026-10-20 00:00:00');

    // Y los puntos son exactamente los de la ventana, sin huecos ni repetidos
    const desde = Date.parse('2026-10-20T10:01:30Z') - 7 * 24 * H;
    const hasta = Date.parse('2026-10-20T10:01:30Z');
    expect(r2.puntos.map(p => p.t)).toEqual(eventos.filter(t => t >= desde && t <= hasta));
  });

  it('un día ya pasado no se vuelve a pedir durante horas (y sí pasadas 6 h)', async () => {
    relojEn('2026-10-20T10:00:00Z');
    const s = cargar();
    eventos = cada(10 * MIN, Date.parse('2026-10-17T00:00:00Z'), Date.parse('2026-10-17T20:00:00Z'));
    cartrackFalso();
    const ventana = { ...base, desde: new Date('2026-10-17T06:00:00Z'), hasta: new Date('2026-10-17T18:00:00Z') };

    await s.obtenerRecorrido(ventana);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date('2026-10-20T15:00:00Z'));
    await s.obtenerRecorrido(ventana);
    // Otro servicio de la misma ambulancia ese mismo día comparte el bloque
    await s.obtenerRecorrido({ ...ventana, desde: new Date('2026-10-17T19:00:00Z'), hasta: new Date('2026-10-17T20:00:00Z') });
    expect(global.fetch).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date('2026-10-20T16:01:00Z'));
    await s.obtenerRecorrido(ventana);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('un día recién cerrado (< 10 min) no se congela: TTL de 1 min', async () => {
    relojEn('2026-10-20T22:05:00Z'); // 00:05 del 21 en España: el 20 cerró hace 5 min
    const s = cargar();
    eventos = cada(10 * MIN, Date.parse('2026-10-20T18:00:00Z'), Date.parse('2026-10-20T21:59:00Z'));
    cartrackFalso();
    const ventana = { ...base, desde: new Date('2026-10-20T18:00:00Z'), hasta: new Date('2026-10-20T21:59:00Z') };

    await s.obtenerRecorrido(ventana);
    jest.setSystemTime(new Date('2026-10-20T22:06:30Z'));
    await s.obtenerRecorrido(ventana);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    // A las 00:20 ya lleva más de 10 min cerrado: se pide una última vez y queda 6 h
    jest.setSystemTime(new Date('2026-10-20T22:20:00Z'));
    await s.obtenerRecorrido(ventana);
    jest.setSystemTime(new Date('2026-10-20T23:20:00Z'));
    await s.obtenerRecorrido(ventana);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('el primer y el último día se recortan a la ventana pedida', async () => {
    relojEn('2026-10-20T10:00:00Z');
    const s = cargar();
    eventos = cada(5 * MIN, Date.parse('2026-10-17T22:00:00Z'), Date.parse('2026-10-19T21:55:00Z'));
    cartrackFalso();
    // 18-oct 10:32 → 19-oct 09:17, hora de España
    const desde = instanteEnEspana(2026, 10, 18, 10, 32).getTime();
    const hasta = instanteEnEspana(2026, 10, 19, 9, 17).getTime();

    const r = await s.obtenerRecorrido({ ...base, desde: new Date(desde), hasta: new Date(hasta) });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(inicios()).toEqual(['2026-10-18 00:00:00', '2026-10-19 00:00:00']);
    const ts = r.puntos.map(p => p.t);
    expect(ts).toEqual(eventos.filter(t => t >= desde && t <= hasta));
    expect(ts[0]).toBeGreaterThanOrEqual(desde);
    expect(ts[ts.length - 1]).toBeLessThanOrEqual(hasta);
  });

  it.each([
    ['otoño (25 h, 25-oct-2026)', '2026-10-24T18:00:00Z', '2026-10-26T04:00:00Z', 3, 4],
    ['primavera (23 h, 29-mar-2026)', '2026-03-28T18:00:00Z', '2026-03-30T04:00:00Z', 3, 3],
  ])('cambio de hora en %s: ni se pierde ni se repite un punto en las medianoches', async (_n, ini, fin, nDias, nLlamadas) => {
    relojEn('2026-11-02T10:00:00Z');
    const s = cargar();
    // Cada minuto en punto: caen eventos justo en las 00:00 de España de cada día
    eventos = cada(MIN, Date.parse(ini), Date.parse(fin));
    cartrackFalso();

    const r = await s.obtenerRecorrido({ ...base, desde: new Date(ini), hasta: new Date(fin) });
    expect(s.diasDeLaVentana(new Date(ini), new Date(fin))).toHaveLength(nDias);
    // El día de 25 h pasa del tope de 24 h por llamada: dos tramos
    expect(global.fetch).toHaveBeenCalledTimes(nLlamadas);
    expect(r.puntos.map(p => p.t)).toEqual(eventos);
  });

  it('los días del cambio de hora duran 25 y 23 h', () => {
    const s = cargar();
    const [otono] = s.diasDeLaVentana(new Date('2026-10-25T10:00:00Z'), new Date('2026-10-25T11:00:00Z'));
    expect(otono).toMatchObject({ dia: '2026-10-25', inicio: Date.parse('2026-10-24T22:00:00Z') });
    expect(otono.fin - otono.inicio).toBe(25 * H);
    const [prim] = s.diasDeLaVentana(new Date('2026-03-29T10:00:00Z'), new Date('2026-03-29T11:00:00Z'));
    expect(prim.fin - prim.inicio).toBe(23 * H);
  });

  it('un día que falla: devuelve los buenos con el error, no pide los siguientes y no cachea el fallo', async () => {
    relojEn('2026-10-20T10:00:00Z');
    const s = cargar();
    eventos = cada(H, Date.parse('2026-10-14T00:00:00Z'), Date.parse('2026-10-17T00:00:00Z'));
    cartrackFalso();
    const ventana = { ...base, desde: new Date('2026-10-14T06:00:00Z'), hasta: new Date('2026-10-16T18:00:00Z') };
    // El 15 falla
    const deVerdad = global.fetch.getMockImplementation();
    global.fetch.mockImplementation(async (url) => (
      new URL(url).searchParams.get('start_timestamp').startsWith('2026-10-15')
        ? respuesta({}, { ok: false, status: 500 })
        : deVerdad(url)
    ));

    const r = await s.obtenerRecorrido(ventana);
    expect(r.error).toMatch(/500/);
    expect(inicios()).toEqual(['2026-10-14 00:00:00', '2026-10-15 00:00:00']);
    expect(r.puntos.length).toBeGreaterThan(0);
    expect(r.puntos.every(p => p.t < Date.parse('2026-10-14T22:00:00Z'))).toBe(true);

    // Vuelve Cartrack: el 14 sale de caché, el 15 y el 16 se piden
    global.fetch.mockImplementation(deVerdad);
    const r2 = await s.obtenerRecorrido(ventana);
    expect(r2.error).toBeNull();
    expect(inicios().slice(2)).toEqual(['2026-10-15 00:00:00', '2026-10-16 00:00:00']);
    const desde = ventana.desde.getTime();
    const hasta = ventana.hasta.getTime();
    expect(r2.puntos.map(p => p.t)).toEqual(eventos.filter(t => t >= desde && t <= hasta));
  });

  it('una carga lenta pide hoy hasta su propio «ahora» y su minuto de caché no nace caducado', async () => {
    relojEn('2026-10-20T10:00:00Z');
    const s = cargar();
    eventos = cada(10 * MIN, Date.parse('2026-10-17T00:00:00Z'), Date.parse('2026-10-20T12:00:00Z'));
    cartrackFalso();
    // Cada llamada a Cartrack «tarda» 40 s
    const deVerdad = global.fetch.getMockImplementation();
    global.fetch.mockImplementation(async (url) => {
      jest.setSystemTime(new Date(Date.now() + 40 * 1000));
      return deVerdad(url);
    });

    await s.obtenerRecorrido({ ...base, desde: new Date('2026-10-17T08:00:00Z'), hasta: new Date('2026-10-20T10:00:00Z') });
    expect(global.fetch).toHaveBeenCalledTimes(4);
    // Hoy se pidió cuando ya eran las 10:02 UTC (12:02 en España), no a las 10:00
    const finHoy = new URL(global.fetch.mock.calls[3][0]).searchParams.get('end_timestamp');
    expect(finHoy).toBe('2026-10-20 12:02:00');

    // 30 s después de acabar, hoy sigue en caché
    jest.setSystemTime(new Date(Date.now() + 30 * 1000));
    await s.obtenerRecorrido({ ...base, desde: new Date('2026-10-17T08:00:00Z'), hasta: new Date() });
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it('un día que agota las páginas no se cachea 6 h: está cortado', async () => {
    relojEn('2026-10-20T10:00:00Z');
    const s = cargar();
    global.fetch.mockImplementation(async () => respuesta({ data: [{
      vehicle_id: 454742160, registration: REG, latitude: 40.3, longitude: -3.6, speed: 50,
      event_ts: '2026-10-17 10:00:00+02',
    }], meta: { last_page: 99 } }));
    const ventana = { ...base, desde: new Date('2026-10-17T06:00:00Z'), hasta: new Date('2026-10-17T18:00:00Z') };

    await s.obtenerRecorrido(ventana);
    expect(global.fetch).toHaveBeenCalledTimes(10);
    jest.setSystemTime(new Date('2026-10-20T10:02:00Z'));
    await s.obtenerRecorrido(ventana);
    expect(global.fetch).toHaveBeenCalledTimes(20);
  });
});
