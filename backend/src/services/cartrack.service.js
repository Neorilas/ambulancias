/**
 * services/cartrack.service.js
 * Posición de la flota, leída de la API de Cartrack (el GPS que llevan las
 * ambulancias). Solo lectura: aquí no se guarda nada en nuestra base de datos.
 *
 * REGLA DE ORO, la misma que en `push.service`: nada de lo que hay aquí puede
 * romper la petición que lo invoca. Cartrack es un tercero y se cae, tarda o
 * cambia un nombre de campo cuando le parece; el mapa se queda sin puntos, no
 * se convierte en un 500. Todo lo público captura sus errores y devuelve un
 * resumen.
 *
 * Las credenciales viven SOLO en el entorno (`CARTRACK_USER`/`CARTRACK_KEY`):
 * este repositorio es público y el navegador nunca habla con Cartrack — el
 * frontend le pide los datos a nuestro backend y las credenciales no salen de
 * aquí.
 */

'use strict';

const logger = require('../utils/logger.utils');
const { ahora } = require('../utils/fecha.utils');
const { extraerMatricula } = require('../utils/matricula.utils');

// ============================================================
// Configuración
// ============================================================

// La región importa: con la URL de otro país las mismas credenciales dan 401.
const BASE_URL = (process.env.CARTRACK_BASE_URL || 'https://fleetapi-es.cartrack.com/rest')
  .replace(/\/+$/, '');
const USUARIO = process.env.CARTRACK_USER || '';
const CLAVE   = process.env.CARTRACK_KEY  || '';

/**
 * Cuánto se espera a Cartrack antes de darlo por perdido.
 *
 * Corto a propósito: al otro lado hay un administrador mirando un mapa que se
 * refresca solo cada 30 s. Una respuesta que tarda 20 s no le sirve de nada y
 * mientras tanto tiene la petición ocupada; es mejor decirle «ahora mismo no
 * hay datos» y volver a intentarlo en el siguiente refresco.
 */
const TIMEOUT_MS = Number(process.env.CARTRACK_TIMEOUT_MS) > 0
  ? Number(process.env.CARTRACK_TIMEOUT_MS)
  : 8000;

/**
 * Vida de la caché en memoria.
 *
 * Cartrack limita `/vehicles/status` a 60 llamadas por minuto y el límite es de
 * la CUENTA, no de cada usuario: si cada administrador con el mapa abierto
 * disparara su propia llamada, cuatro pestañas refrescando cada 30 s ya serían
 * 8 llamadas/min y una tarde con el mapa proyectado en la oficina podría
 * acercarse al tope. Con la caché compartida son 2 llamadas/min haya quien
 * haya mirando, y de paso el mapa abre al instante en vez de esperar al
 * tercero.
 */
const CACHE_MS = Number(process.env.CARTRACK_CACHE_MS) > 0
  ? Number(process.env.CARTRACK_CACHE_MS)
  : 30 * 1000;

/**
 * Hasta cuándo se sigue sirviendo una caché caducada cuando Cartrack falla.
 *
 * Un corte de 30 s no debería vaciar el mapa: es preferible pintar la última
 * posición conocida con su hora al lado —que el frontend enseña siempre— que
 * dejar la pantalla en blanco. Pasados 10 minutos ya no es «la última
 * posición», es historia, y entonces sí se dice que no hay datos.
 */
const CACHE_VIEJA_MAX_MS = 10 * 60 * 1000;

/** ¿Hay credenciales? Sin ellas el módulo queda inerte y la app funciona igual. */
function estaConfigurado() {
  return Boolean(USUARIO && CLAVE);
}

if (!estaConfigurado()) {
  logger.warn('Cartrack deshabilitado: faltan CARTRACK_USER / CARTRACK_KEY');
}

// ============================================================
// Lectura tolerante de la respuesta
// ============================================================

/**
 * Primer valor no vacío de una lista de rutas posibles ('location.latitude').
 *
 * Por qué varias rutas y no el nombre bueno y ya: el contrato de Cartrack se
 * ha leído del OpenAPI oficial, no de una llamada real con nuestras
 * credenciales (ver `scripts/sonda-cartrack.js`). Mientras eso no se confirme
 * contra la cuenta de verdad, aceptar los alias habituales es la diferencia
 * entre un mapa que funciona y uno lleno de `undefined` — y cuando se
 * confirme, sobra código, no falta.
 */
function leer(objeto, rutas) {
  for (const ruta of rutas) {
    let valor = objeto;
    for (const parte of ruta.split('.')) {
      valor = valor?.[parte];
      if (valor === undefined || valor === null) break;
    }
    if (valor !== undefined && valor !== null && valor !== '') return valor;
  }
  return null;
}

/** Número o null. Cartrack manda algunos campos numéricos como texto. */
function aNumero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * Booleano o null. `ignition` puede llegar como true, "true", 1, "ON"…
 * null (desconocido) NO es lo mismo que false (apagado) y se respeta: un
 * vehículo del que no sabemos si tiene el contacto puesto no debe pintarse
 * como apagado.
 */
function aBooleano(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'boolean') return valor;
  const t = String(valor).trim().toLowerCase();
  if (['1', 'true', 'on', 'yes', 'y', 'si', 'sí'].includes(t)) return true;
  if (['0', 'false', 'off', 'no', 'n'].includes(t)) return false;
  return null;
}

/** Fecha en ISO o null, descartando lo que no sea una fecha válida. */
function aIso(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Metros o kilómetros, según lo que haya contestado Cartrack.
 *
 * La petición pide ya los km (`odometer_in_km=true`), así que en condiciones
 * normales aquí no hay nada que convertir. Esto es la RED DE SEGURIDAD por si
 * el parámetro se ignora: un odómetro en metros junto a los km de nuestra
 * ficha del vehículo, en la misma pantalla, acaba en un «el mapa dice que
 * tiene 235 millones de kilómetros».
 *
 * El corte está en un millón y no más abajo porque 235.400 es un kilometraje
 * de lo más normal en una ambulancia y dividirlo daría 235 km — fue justo lo
 * que cazó el test. Un millón de km no lo alcanza ningún vehículo de la flota,
 * así que por encima de ahí solo pueden ser metros. Queda un hueco: una
 * ambulancia recién estrenada con menos de 1.000 km reportada en metros se
 * leería como km. Se asume, porque el parámetro de la petición ya lo cubre y
 * el caso dura unas semanas en la vida de un vehículo.
 */
function odometroEnKm(valor) {
  if (valor === null) return null;
  return Math.round(valor > 1000000 ? valor / 1000 : valor);
}

/**
 * Nombre del conductor, que Cartrack manda partido en dos.
 *
 * Ojo con el `driver` a secas: en la respuesta real es un OBJETO
 * (`{driver_id, first_name, last_name, ...}`), no una cadena. Devolverlo tal
 * cual metía el objeto entero en el campo `conductor` y React revienta al
 * intentar pintarlo. Aquí solo sale texto o null.
 */
function nombreConductor(fila) {
  const nombre = [
    leer(fila, ['driver.first_name', 'driver_first_name']),
    leer(fila, ['driver.last_name',  'driver_last_name']),
  ].filter(v => typeof v === 'string' && v.trim()).join(' ').trim();
  if (nombre) return nombre;

  const suelto = leer(fila, ['driver.name', 'driver_name', 'driver']);
  return typeof suelto === 'string' && suelto.trim() ? suelto.trim() : null;
}

/** Una fila de Cartrack → la forma que entiende el resto de la app. */
function normalizarVehiculo(fila) {
  const matriculaOriginal = leer(fila, ['registration', 'registration_number', 'vehicle_registration', 'plate']);
  const odometro = aNumero(leer(fila, ['odometer', 'odometer_km', 'odometer_in_km', 'mileage']));

  return {
    cartrackId: leer(fila, ['vehicle_id', 'id', 'terminal_id']),
    matriculaOriginal: matriculaOriginal ? String(matriculaOriginal) : null,
    // `registration` viene con el nombre del vehículo delante
    // (`UVI-3-7740MZB`): hay que SACAR la matrícula, no normalizar el texto
    // entero, o el cruce no encuentra ni uno (ver `extraerMatricula`).
    matricula: extraerMatricula(matriculaOriginal),
    lat: aNumero(leer(fila, ['location.latitude', 'latitude', 'lat', 'position.latitude'])),
    lng: aNumero(leer(fila, ['location.longitude', 'longitude', 'lng', 'lon', 'position.longitude'])),
    ubicacion: leer(fila, ['location.position_description', 'position_description', 'address', 'location.address']),
    velocidad: aNumero(leer(fila, ['speed', 'speed_kmh', 'location.speed'])),
    rumbo: aNumero(leer(fila, ['bearing', 'heading', 'location.bearing'])),
    contacto: aBooleano(leer(fila, ['ignition', 'ignition_on', 'status.ignition'])),
    ralenti: aBooleano(leer(fila, ['idling', 'is_idling'])),
    odometroKm: odometroEnKm(odometro),
    conductor: nombreConductor(fila),
    combustible: aNumero(leer(fila, ['fuel.level', 'fuel_level', 'fuel'])),
    // Momento del dato, no de la consulta: un vehículo aparcado en un garaje
    // sin cobertura sigue devolviendo su última posición, de hace horas.
    actualizado: aIso(leer(fila, ['event_ts', 'location.event_ts', 'timestamp', 'last_update', 'gps_ts'])),
  };
}

/**
 * La lista de vehículos, venga como venga envuelta.
 * Se han visto las tres formas en APIs de este estilo y ninguna cuesta nada de
 * soportar: array pelado, `{ data: [...] }` o `{ vehicles: [...] }`.
 */
function extraerLista(cuerpo) {
  if (Array.isArray(cuerpo)) return cuerpo;
  for (const clave of ['data', 'vehicles', 'results', 'items']) {
    if (Array.isArray(cuerpo?.[clave])) return cuerpo[clave];
  }
  return [];
}

// ============================================================
// Llamada + caché compartida
// ============================================================

let cache = null;      // { vehiculos, at: Date }
let enVuelo = null;    // promesa de la llamada en curso (single-flight)

/** Cabecera Basic. Se construye en cada llamada: no hay nada que cachear aquí. */
function cabeceraAuth() {
  return 'Basic ' + Buffer.from(`${USUARIO}:${CLAVE}`).toString('base64');
}

/** La llamada de verdad. Lanza; solo la usa `refrescar`, que captura. */
async function pedirEstados() {
  // `odometer_in_km` evita tener que adivinar la unidad del odómetro (ver
  // `odometroEnKm`). Si la cuenta ignorara el parámetro, la red de seguridad
  // sigue ahí y la sonda de fase 0 lo delata en la primera fila.
  const url = `${BASE_URL}/vehicles/status?odometer_in_km=true`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: cabeceraAuth(), Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    // El cuerpo del error se lee pero NO se registra entero: en un 401 puede
    // venir de vuelta parte de lo que mandamos.
    const detalle = res.status === 401
      ? 'credenciales rechazadas (revisa CARTRACK_USER/KEY y que la URL sea la de España)'
      : res.status === 429
        ? 'límite de llamadas alcanzado'
        : `respuesta ${res.status}`;
    const err = new Error(`Cartrack: ${detalle}`);
    err.status = res.status;
    throw err;
  }

  const cuerpo = await res.json();
  return extraerLista(cuerpo).map(normalizarVehiculo);
}

/**
 * Refresca la caché. Single-flight: si ya hay una llamada en vuelo, los que
 * llegan detrás esperan a esa en vez de abrir la suya. Sin esto, tres admins
 * abriendo el mapa a la vez tras expirar la caché harían tres llamadas para
 * el mismo dato.
 */
function refrescar() {
  if (enVuelo) return enVuelo;

  enVuelo = pedirEstados()
    .then((vehiculos) => {
      cache = { vehiculos, at: ahora() };
      return { vehiculos, error: null };
    })
    .catch((err) => {
      const mensaje = err?.name === 'TimeoutError' || err?.name === 'AbortError'
        ? `Cartrack no respondió en ${TIMEOUT_MS} ms`
        : (err?.message || 'error desconocido');
      logger.warn(`Cartrack: no se pudo leer el estado de la flota — ${mensaje}`);
      return { vehiculos: null, error: mensaje };
    })
    .finally(() => { enVuelo = null; });

  return enVuelo;
}

/**
 * Estado actual de la flota según Cartrack.
 *
 * Nunca lanza. Devuelve siempre la misma forma, y `origen` dice de dónde salen
 * los datos para que la pantalla pueda ser honesta con quien la mira:
 *   - `api`         → recién pedidos
 *   - `cache`       → los de hace menos de CACHE_MS, sin llamar
 *   - `cache-vieja` → Cartrack ha fallado y se sirve lo último que hubo
 *   - `ninguno`     → no hay datos que dar (y `error` explica por qué)
 */
async function obtenerEstados() {
  if (!estaConfigurado()) {
    return { vehiculos: [], origen: 'ninguno', actualizado: null, error: null, configurado: false };
  }

  const ahoraMs = ahora().getTime();
  if (cache && ahoraMs - cache.at.getTime() < CACHE_MS) {
    return {
      vehiculos: cache.vehiculos, origen: 'cache',
      actualizado: cache.at.toISOString(), error: null, configurado: true,
    };
  }

  const { vehiculos, error } = await refrescar();

  if (vehiculos) {
    return {
      vehiculos, origen: 'api',
      actualizado: cache.at.toISOString(), error: null, configurado: true,
    };
  }

  // Ha fallado: la última foto conocida vale más que una pantalla vacía,
  // siempre que siga siendo reciente.
  if (cache && ahoraMs - cache.at.getTime() < CACHE_VIEJA_MAX_MS) {
    return {
      vehiculos: cache.vehiculos, origen: 'cache-vieja',
      actualizado: cache.at.toISOString(), error, configurado: true,
    };
  }

  return { vehiculos: [], origen: 'ninguno', actualizado: null, error, configurado: true };
}

/** Vacía la caché. Solo para los tests: en producción nadie la invalida a mano. */
function _vaciarCache() {
  cache = null;
  enVuelo = null;
}

module.exports = {
  estaConfigurado,
  obtenerEstados,
  // Expuestos para los tests
  normalizarVehiculo,
  nombreConductor,
  extraerLista,
  leer,
  _vaciarCache,
  CACHE_MS,
  TIMEOUT_MS,
};
