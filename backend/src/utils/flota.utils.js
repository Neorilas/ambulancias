/**
 * utils/flota.utils.js
 * El cruce entre lo que ve el GPS de Cartrack y lo que sabe nuestra app.
 *
 * Está aparte del controlador a propósito: es la única parte del mapa que
 * tiene reglas de verdad (qué es «en movimiento», cuándo un vehículo está
 * incomunicado, qué hacer con una matrícula que aparece dos veces) y merece
 * tests que no necesiten ni base de datos ni red.
 *
 * El vínculo es la MATRÍCULA NORMALIZADA (`matricula.utils`), que es lo único
 * que las dos partes conocen: Cartrack no sabe nada de nuestros identificadores
 * ni de los alias de las ambulancias.
 */

'use strict';

const { normalizarMatricula } = require('./matricula.utils');

/**
 * Velocidad a partir de la cual se considera que el vehículo se mueve.
 *
 * No es 0: un GPS parado en un aparcamiento oscila entre 0 y 2 km/h él solo, y
 * con el umbral en cero media flota aparecería «en movimiento» de madrugada.
 */
const UMBRAL_MOVIMIENTO_KMH = 3;

/**
 * Minutos sin dar señal a partir de los cuales el dato deja de ser «dónde
 * está» y pasa a ser «dónde estaba». Un GPS sano manda posición cada pocos
 * minutos; 30 sin abrir la boca es un vehículo en un sótano, un equipo
 * desconectado o una avería, y las tres cosas se merecen un color propio en
 * vez de una posición vieja pintada como si fuera de ahora.
 */
const MINUTOS_SIN_SENAL = 30;

const ESTADOS = {
  MOVIMIENTO:      'movimiento',
  PARADO_CONTACTO: 'parado_contacto',
  APAGADO:         'apagado',
  SIN_SENAL:       'sin_senal',
  SIN_GPS:         'sin_gps',
};

/**
 * Estado de un vehículo a partir de su último dato de GPS.
 *
 * El orden de las preguntas importa: primero si el dato sirve (¿hay posición?,
 * ¿es reciente?) y solo después qué dice. Un vehículo que lleva dos horas sin
 * reportar puede tener guardado `speed: 90` de cuando se le fue la cobertura en
 * la autovía, y pintarlo como «en movimiento» sería mentir con datos ciertos.
 */
function estadoDeGps(gps, { ahora = new Date(), minutosSinSenal = MINUTOS_SIN_SENAL } = {}) {
  if (!gps) return ESTADOS.SIN_GPS;
  if (gps.lat === null || gps.lng === null) return ESTADOS.SIN_SENAL;

  if (gps.actualizado) {
    const edadMin = (ahora.getTime() - new Date(gps.actualizado).getTime()) / 60000;
    if (edadMin > minutosSinSenal) return ESTADOS.SIN_SENAL;
  }

  if (gps.velocidad !== null && gps.velocidad > UMBRAL_MOVIMIENTO_KMH) return ESTADOS.MOVIMIENTO;
  if (gps.contacto === true) return ESTADOS.PARADO_CONTACTO;
  return ESTADOS.APAGADO;
}

/** Minutos desde el último dato, o null si no hay fecha. */
function minutosDesde(iso, ahora) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((ahora.getTime() - t) / 60000));
}

/**
 * Agrupa por matrícula normalizada y deja ver los duplicados.
 * Devuelve un Map<matricula, elemento[]>; las matrículas vacías se descartan,
 * porque «sin matrícula» no es una matrícula compartida.
 */
function porMatricula(lista, campo) {
  const mapa = new Map();
  for (const item of lista) {
    const clave = normalizarMatricula(item[campo]);
    if (!clave) continue;
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(item);
  }
  return mapa;
}

/**
 * Cruza nuestra flota con las posiciones de Cartrack.
 *
 * Los cuatro casos del plan, y por qué ninguno se puede barrer bajo la alfombra:
 *
 *  - **Vinculado**: una matrícula nuestra, un GPS. Lo normal.
 *  - **Nuestro sin GPS** (`sin_gps`): o no lleva equipo, o la matrícula está
 *    mal escrita en la ficha. Hay que verlo para poder arreglarlo — y ojo, que
 *    en su día la flota se dio de alta con el nombre de la ambulancia en el
 *    campo `matricula` (la migración v14 lo deshizo en parte): si de golpe hay
 *    muchos así, mirar ahí antes que a Cartrack.
 *  - **GPS sin vehículo nuestro** (`solo-gps`): un equipo en un vehículo que no
 *    tenemos dado de alta, o una baja que nadie retiró de la cuenta de Cartrack.
 *  - **Ambigua**: la misma matrícula normalizada en dos sitios. NO se vincula
 *    nada: elegir al azar pintaría el vehículo A con la posición del B, que es
 *    peor que no pintar nada. Sale marcado para que alguien lo corrija.
 *
 * @param {object}   params
 * @param {object[]} params.vehiculos  Nuestros vehículos ({id, matricula, alias, ...})
 * @param {object[]} params.gps        Vehículos normalizados de cartrack.service
 * @param {Date}     [params.ahora]    Instante de referencia (los tests lo fijan)
 * @param {number}   [params.minutosSinSenal]
 */
function cruzarFlota({ vehiculos = [], gps = [], ahora = new Date(), minutosSinSenal = MINUTOS_SIN_SENAL } = {}) {
  const nuestrosPorMatricula = porMatricula(vehiculos, 'matricula');
  const gpsPorMatricula      = porMatricula(gps, 'matricula');

  const flota = [];
  const usadas = new Set();

  for (const vehiculo of vehiculos) {
    const clave = normalizarMatricula(vehiculo.matricula);
    const candidatosGps = clave ? (gpsPorMatricula.get(clave) || []) : [];
    const duplicadaAqui = clave ? (nuestrosPorMatricula.get(clave) || []).length > 1 : false;
    const ambigua = duplicadaAqui || candidatosGps.length > 1;

    const enlazado = !ambigua && candidatosGps.length === 1 ? candidatosGps[0] : null;
    if (clave && candidatosGps.length) usadas.add(clave);

    flota.push(construirEntrada({
      clave: `v-${vehiculo.id}`,
      vehiculo,
      gps: enlazado,
      vinculo: enlazado ? 'vinculado' : 'solo-app',
      ambigua,
      ahora,
      minutosSinSenal,
    }));
  }

  // Lo que el GPS ve y nosotros no tenemos. Va al final de la lista: son
  // excepciones que hay que resolver, no flota que gestionar.
  for (const punto of gps) {
    const clave = normalizarMatricula(punto.matricula);
    if (clave && usadas.has(clave)) continue;

    flota.push(construirEntrada({
      clave: `gps-${punto.cartrackId ?? clave ?? flota.length}`,
      vehiculo: null,
      gps: punto,
      vinculo: 'solo-gps',
      ambigua: clave ? (gpsPorMatricula.get(clave) || []).length > 1 : false,
      ahora,
      minutosSinSenal,
    }));
  }

  const resumen = {
    total:      flota.length,
    vinculados: flota.filter(f => f.vinculo === 'vinculado').length,
    sinGps:     flota.filter(f => f.vinculo === 'solo-app').length,
    sinVehiculo:flota.filter(f => f.vinculo === 'solo-gps').length,
    ambiguos:   flota.filter(f => f.ambigua).length,
    enMovimiento: flota.filter(f => f.estado === ESTADOS.MOVIMIENTO).length,
  };

  return { flota, resumen };
}

/** Una fila de la lista/mapa, con todo lo que la pantalla necesita ya resuelto. */
function construirEntrada({ clave, vehiculo, gps, vinculo, ambigua, ahora, minutosSinSenal }) {
  return {
    clave,
    vinculo,
    ambigua,
    vehiculoId: vehiculo?.id ?? null,
    // El alias es el titular de cara al usuario (así se llama la ambulancia en
    // la casa); de un GPS suelto no tenemos alias y se enseña la matrícula.
    alias:      vehiculo?.alias ?? null,
    matricula:  vehiculo?.matricula ?? gps?.matriculaOriginal ?? null,
    kilometrosApp: vehiculo?.kilometros_actuales ?? null,
    estado: estadoDeGps(gps, { ahora, minutosSinSenal }),
    gps: gps ? {
      lat: gps.lat,
      lng: gps.lng,
      ubicacion: gps.ubicacion,
      velocidad: gps.velocidad,
      rumbo: gps.rumbo,
      contacto: gps.contacto,
      odometroKm: gps.odometroKm,
      conductor: gps.conductor,
      actualizado: gps.actualizado,
      minutosDesdeDato: minutosDesde(gps.actualizado, ahora),
    } : null,
    asignacion: vehiculo?.asignacion ?? null,
  };
}

// ============================================================
// Recorrido de un servicio
// ============================================================

/** Distancia en km entre dos puntos (haversine). */
function kmEntre(a, b) {
  const rad = (g) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Menos de esto entre dos puntos seguidos no se pinta: un GPS parado oscila
 * unos metros y, con un punto cada 10 s, una hora en la puerta de un hospital
 * eran 360 puntos dibujando un ovillo.
 */
const METROS_MIN_ENTRE_PUNTOS = 15;

/**
 * Un hueco de más de esto en el que además el vehículo aparece en otro sitio
 * se CORTA en vez de unirse: la línea recta entre dos puntos separados por un
 * túnel o un garaje sin cobertura dibujaría un camino que no se hizo.
 */
const HUECO_MAX_SEGUNDOS = 5 * 60;
const SALTO_MIN_KM_PARA_CORTAR = 0.3;

/**
 * Un punto al que habría que llegar a más de esto desde el anterior no es de
 * este viaje y se descarta. Se vio con datos reales (2026-10-19): con puntos
 * de dos ambulancias mezclados (el filtro `vehicle_id` de Cartrack no filtra,
 * ver `cartrack.service`) un día de 600 km sumaba 174.000. El servicio ya
 * filtra bien; esto es la segunda red, y la de un GPS que salte sin fix.
 */
const VELOCIDAD_IMPOSIBLE_KMH = 250;

/**
 * Puntos GPS ordenados → lo que pinta el mapa del servicio.
 *
 * Devuelve `tramos` (listas de `[lat, lng]` con 5 decimales, ~1 m: más es
 * peso sin precisión real), el primer y último punto con su hora, los km
 * (sumados solo dentro de los tramos: un salto cortado no se cuenta como
 * recorrido) y cuántos puntos llegaron de Cartrack.
 */
function construirRecorrido(puntos) {
  const lista = (puntos || []).filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng) && Number.isFinite(p?.t));
  if (!lista.length) return { tramos: [], inicio: null, fin: null, km: 0, puntos: 0 };

  const redondear = (n) => Math.round(n * 1e5) / 1e5;
  const tramos = [];
  let tramo = [];
  let ultimo = null;
  let km = 0;

  for (const p of lista) {
    if (!ultimo) {
      tramo.push([redondear(p.lat), redondear(p.lng)]);
      ultimo = p;
      continue;
    }
    const d = kmEntre(ultimo, p);
    const hueco = (p.t - ultimo.t) / 1000;
    // Mismo segundo y en otro sitio, o demasiado lejos para el tiempo pasado
    if (d > 0.05 && (hueco <= 0 || d / (hueco / 3600) > VELOCIDAD_IMPOSIBLE_KMH)) continue;
    if (hueco > HUECO_MAX_SEGUNDOS && d > SALTO_MIN_KM_PARA_CORTAR) {
      if (tramo.length) tramos.push(tramo);
      tramo = [[redondear(p.lat), redondear(p.lng)]];
      ultimo = p;
      continue;
    }
    if (d * 1000 < METROS_MIN_ENTRE_PUNTOS) continue;
    tramo.push([redondear(p.lat), redondear(p.lng)]);
    km += d;
    ultimo = p;
  }
  if (tramo.length) tramos.push(tramo);

  const primero = lista[0];
  const final = lista[lista.length - 1];
  return {
    tramos,
    inicio: { lat: primero.lat, lng: primero.lng, at: new Date(primero.t).toISOString() },
    fin:    { lat: final.lat,   lng: final.lng,   at: new Date(final.t).toISOString() },
    km: Math.round(km * 10) / 10,
    puntos: lista.length,
  };
}

module.exports = {
  cruzarFlota,
  construirRecorrido,
  kmEntre,
  estadoDeGps,
  minutosDesde,
  ESTADOS,
  UMBRAL_MOVIMIENTO_KMH,
  MINUTOS_SIN_SENAL,
};
