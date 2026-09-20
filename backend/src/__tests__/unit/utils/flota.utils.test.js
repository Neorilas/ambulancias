'use strict';

/**
 * Tests de utils/flota.utils.js
 *
 * Es el cruce entre el GPS y nuestra flota: no habla con nadie, así que aquí
 * no hace falta mockear nada. Lo que se fija es lo que no se puede deducir
 * mirando el código dentro de seis meses: que un dato viejo no se pinta como
 * si fuera de ahora, y que una matrícula ambigua NO se vincula a ciegas.
 */

const {
  cruzarFlota,
  estadoDeGps,
  minutosDesde,
  ESTADOS,
} = require('../../../utils/flota.utils');

const AHORA = new Date('2026-09-20T12:00:00.000Z');

/** Punto de GPS con valores por defecto sanos; cada test cambia lo suyo. */
const punto = (over = {}) => ({
  cartrackId: 'ct-1',
  matricula: '1234BCD',
  matriculaOriginal: '1234 BCD',
  lat: 40.4,
  lng: -3.7,
  ubicacion: 'Calle Mayor, Madrid',
  velocidad: 0,
  rumbo: 90,
  contacto: false,
  odometroKm: 120000,
  conductor: null,
  actualizado: AHORA.toISOString(),
  ...over,
});

const vehiculo = (over = {}) => ({
  id: 1,
  matricula: '1234BCD',
  alias: 'Ambulancia 1',
  kilometros_actuales: 119800,
  asignacion: null,
  ...over,
});

describe('estadoDeGps', () => {
  it('sin GPS es sin_gps', () => {
    expect(estadoDeGps(null, { ahora: AHORA })).toBe(ESTADOS.SIN_GPS);
  });

  it('sin coordenadas es sin_senal aunque el dato sea de ahora mismo', () => {
    expect(estadoDeGps(punto({ lat: null, lng: null }), { ahora: AHORA })).toBe(ESTADOS.SIN_SENAL);
  });

  it('en movimiento por encima del umbral', () => {
    expect(estadoDeGps(punto({ velocidad: 54 }), { ahora: AHORA })).toBe(ESTADOS.MOVIMIENTO);
  });

  it('una oscilación de 2 km/h del GPS parado NO cuenta como movimiento', () => {
    // Es el caso que obligó a poner el umbral: con el corte en 0, media flota
    // aparecía moviéndose de madrugada en su propio aparcamiento.
    expect(estadoDeGps(punto({ velocidad: 2 }), { ahora: AHORA })).toBe(ESTADOS.APAGADO);
  });

  it('parado con el contacto puesto se distingue de apagado', () => {
    expect(estadoDeGps(punto({ velocidad: 0, contacto: true }), { ahora: AHORA }))
      .toBe(ESTADOS.PARADO_CONTACTO);
    expect(estadoDeGps(punto({ velocidad: 0, contacto: false }), { ahora: AHORA }))
      .toBe(ESTADOS.APAGADO);
  });

  it('contacto desconocido y quieto se trata como apagado, no como encendido', () => {
    expect(estadoDeGps(punto({ velocidad: 0, contacto: null }), { ahora: AHORA }))
      .toBe(ESTADOS.APAGADO);
  });

  it('un dato viejo es sin_senal aunque venga con velocidad de autovía', () => {
    // Lo que se guardó fue la última trama antes de perder cobertura. Pintarlo
    // como «en movimiento» sería mentir con datos ciertos.
    const viejo = punto({
      velocidad: 90,
      actualizado: new Date(AHORA.getTime() - 120 * 60000).toISOString(),
    });
    expect(estadoDeGps(viejo, { ahora: AHORA })).toBe(ESTADOS.SIN_SENAL);
  });

  it('el umbral de «sin señal» es configurable', () => {
    const hace10 = punto({ actualizado: new Date(AHORA.getTime() - 10 * 60000).toISOString() });
    expect(estadoDeGps(hace10, { ahora: AHORA, minutosSinSenal: 30 })).toBe(ESTADOS.APAGADO);
    expect(estadoDeGps(hace10, { ahora: AHORA, minutosSinSenal: 5 })).toBe(ESTADOS.SIN_SENAL);
  });

  it('sin fecha del dato no se descarta: se juzga por lo que dice', () => {
    expect(estadoDeGps(punto({ actualizado: null, velocidad: 50 }), { ahora: AHORA }))
      .toBe(ESTADOS.MOVIMIENTO);
  });
});

describe('minutosDesde', () => {
  it('cuenta los minutos desde el dato', () => {
    expect(minutosDesde(new Date(AHORA.getTime() - 7 * 60000).toISOString(), AHORA)).toBe(7);
  });
  it('sin fecha o con basura devuelve null', () => {
    expect(minutosDesde(null, AHORA)).toBeNull();
    expect(minutosDesde('no es una fecha', AHORA)).toBeNull();
  });
  it('un dato del futuro no da minutos negativos', () => {
    expect(minutosDesde(new Date(AHORA.getTime() + 60000).toISOString(), AHORA)).toBe(0);
  });
});

describe('cruzarFlota', () => {
  it('vincula por matrícula normalizada, aunque venga con espacios o guiones', () => {
    const { flota, resumen } = cruzarFlota({
      vehiculos: [vehiculo()],
      gps: [punto({ matricula: '1234BCD', matriculaOriginal: '1234-bcd' })],
      ahora: AHORA,
    });

    expect(resumen.vinculados).toBe(1);
    expect(flota).toHaveLength(1);
    expect(flota[0]).toMatchObject({
      vinculo: 'vinculado',
      vehiculoId: 1,
      alias: 'Ambulancia 1',
      ambigua: false,
    });
    expect(flota[0].gps.lat).toBe(40.4);
  });

  it('un vehículo nuestro sin GPS sale igualmente, marcado', () => {
    const { flota, resumen } = cruzarFlota({
      vehiculos: [vehiculo({ matricula: '9999ZZZ' })],
      gps: [punto()],
      ahora: AHORA,
    });

    const nuestro = flota.find(f => f.vehiculoId === 1);
    expect(nuestro.vinculo).toBe('solo-app');
    expect(nuestro.estado).toBe(ESTADOS.SIN_GPS);
    expect(nuestro.gps).toBeNull();
    expect(resumen.sinGps).toBe(1);
    expect(resumen.sinVehiculo).toBe(1);   // el GPS suelto también se cuenta
  });

  it('un GPS que no tenemos dado de alta se lista al final, sin alias', () => {
    const { flota } = cruzarFlota({
      vehiculos: [vehiculo()],
      gps: [punto(), punto({ cartrackId: 'ct-2', matricula: '5555FFF', matriculaOriginal: '5555 FFF' })],
      ahora: AHORA,
    });

    expect(flota).toHaveLength(2);
    const suelto = flota[flota.length - 1];
    expect(suelto.vinculo).toBe('solo-gps');
    expect(suelto.alias).toBeNull();
    expect(suelto.matricula).toBe('5555 FFF');
    expect(suelto.vehiculoId).toBeNull();
  });

  it('dos vehículos nuestros con la misma matrícula NO se vinculan a ciegas', () => {
    // Elegir uno al azar pintaría el vehículo A con la posición del B: peor
    // que no pintar nada, porque parece un dato bueno.
    const { flota, resumen } = cruzarFlota({
      vehiculos: [vehiculo({ id: 1 }), vehiculo({ id: 2, alias: 'Ambulancia 2' })],
      gps: [punto()],
      ahora: AHORA,
    });

    expect(resumen.ambiguos).toBe(2);
    expect(resumen.vinculados).toBe(0);
    expect(flota.filter(f => f.vehiculoId).every(f => f.gps === null)).toBe(true);
  });

  it('dos GPS con la misma matrícula tampoco se vinculan', () => {
    const { flota, resumen } = cruzarFlota({
      vehiculos: [vehiculo()],
      gps: [punto({ cartrackId: 'ct-1' }), punto({ cartrackId: 'ct-2' })],
      ahora: AHORA,
    });

    expect(resumen.vinculados).toBe(0);
    expect(flota.find(f => f.vehiculoId === 1).ambigua).toBe(true);
  });

  it('las matrículas vacías no se agrupan entre sí', () => {
    // «Sin matrícula» no es una matrícula compartida: dos GPS sin identificar
    // no son el mismo vehículo, ni se vinculan a un vehículo sin matrícula.
    const { flota, resumen } = cruzarFlota({
      vehiculos: [vehiculo({ matricula: null })],
      gps: [punto({ matricula: '', matriculaOriginal: null, cartrackId: 'ct-a' }),
            punto({ matricula: '', matriculaOriginal: null, cartrackId: 'ct-b' })],
      ahora: AHORA,
    });

    expect(resumen.ambiguos).toBe(0);
    expect(flota).toHaveLength(3);
    expect(flota.filter(f => f.vinculo === 'solo-gps')).toHaveLength(2);
  });

  it('arrastra la asignación activa, que es lo que Cartrack no sabe', () => {
    const asignacion = { id: 7, responsable: 'Ana Ruiz', iniciada: true };
    const { flota } = cruzarFlota({
      vehiculos: [vehiculo({ asignacion })],
      gps: [punto()],
      ahora: AHORA,
    });
    expect(flota[0].asignacion).toEqual(asignacion);
  });

  it('sin GPS ninguno devuelve la flota entera como sin_gps', () => {
    const { flota, resumen } = cruzarFlota({
      vehiculos: [vehiculo({ id: 1 }), vehiculo({ id: 2, matricula: '5555FFF' })],
      gps: [],
      ahora: AHORA,
    });
    expect(flota).toHaveLength(2);
    expect(flota.every(f => f.estado === ESTADOS.SIN_GPS)).toBe(true);
    expect(resumen.sinGps).toBe(2);
  });

  it('sin argumentos no revienta', () => {
    expect(cruzarFlota()).toEqual({
      flota: [],
      resumen: { total: 0, vinculados: 0, sinGps: 0, sinVehiculo: 0, ambiguos: 0, enMovimiento: 0 },
    });
  });

  it('cuenta los que se mueven en el resumen', () => {
    const { resumen } = cruzarFlota({
      vehiculos: [vehiculo({ id: 1 }), vehiculo({ id: 2, matricula: '5555FFF' })],
      gps: [punto({ velocidad: 60 }), punto({ cartrackId: 'ct-2', matricula: '5555FFF', velocidad: 0 })],
      ahora: AHORA,
    });
    expect(resumen.enMovimiento).toBe(1);
  });
});
