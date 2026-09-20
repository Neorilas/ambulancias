import { describe, it, expect } from 'vitest';
import {
  ESTADOS,
  FILTROS,
  contarPorFiltro,
  conPosicion,
  estadoMeta,
  filtrarFlota,
  textoFuente,
  textoKilometros,
  textoUltimoDato,
  textoVelocidad,
} from '../../../utils/flota';

/** Entrada tal y como la manda `GET /flota/ubicaciones`. */
const entrada = (over = {}) => ({
  clave: 'v-1',
  vinculo: 'vinculado',
  ambigua: false,
  vehiculoId: 1,
  alias: 'Ambulancia 1',
  matricula: '1234BCD',
  kilometrosApp: 119800,
  estado: ESTADOS.MOVIMIENTO,
  gps: { lat: 40.4, lng: -3.7, velocidad: 54, minutosDesdeDato: 2 },
  asignacion: null,
  ...over,
});

describe('estadoMeta', () => {
  it('da nombre, badge y color a cada estado', () => {
    expect(estadoMeta(ESTADOS.MOVIMIENTO)).toMatchObject({ label: 'En movimiento', badge: 'badge-green' });
    expect(estadoMeta(ESTADOS.SIN_SENAL).badge).toBe('badge-red');
  });

  it('un estado desconocido no rompe la pantalla', () => {
    // Si el backend añade un estado y aquí nadie lo traduce, sale «Desconocido»
    // en gris; lo que no puede es dejar la fila sin pintar.
    expect(estadoMeta('inventado')).toMatchObject({ label: 'Desconocido', badge: 'badge-gray' });
    expect(estadoMeta(undefined).color).toBeTruthy();
  });

  it('los colores son hex literales, no clases de Tailwind', () => {
    // Los consume el SVG del marcador de Leaflet, que se construye fuera de
    // React: una clase de Tailwind compuesta al vuelo la purgaría el build.
    for (const meta of Object.values(ESTADOS).map(estadoMeta)) {
      expect(meta.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('filtrarFlota', () => {
  const flota = [
    entrada({ clave: 'v-1', estado: ESTADOS.MOVIMIENTO }),
    entrada({ clave: 'v-2', alias: 'Ambulancia 2', matricula: '5555FFF', estado: ESTADOS.PARADO_CONTACTO }),
    entrada({ clave: 'v-3', alias: 'Ambulancia 3', matricula: '7777GGG', estado: ESTADOS.APAGADO }),
    entrada({ clave: 'v-4', alias: 'Ambulancia 4', matricula: '8888HHH', estado: ESTADOS.SIN_GPS, vinculo: 'solo-app', gps: null }),
    entrada({ clave: 'gps-9', alias: null, matricula: '9999JJJ', estado: ESTADOS.SIN_SENAL, vinculo: 'solo-gps', vehiculoId: null }),
  ];

  it('sin filtro ni búsqueda devuelve todo', () => {
    expect(filtrarFlota(flota)).toHaveLength(5);
  });

  it('filtra por estado', () => {
    expect(filtrarFlota(flota, { filtro: 'movimiento' }).map(f => f.clave)).toEqual(['v-1']);
    expect(filtrarFlota(flota, { filtro: 'apagados' }).map(f => f.clave)).toEqual(['v-3']);
  });

  it('«sin vincular» junta los dos casos de fallo del cruce', () => {
    // Para quien mira el mapa son el mismo problema: algo que no cuadra entre
    // las dos listas y hay que arreglar.
    expect(filtrarFlota(flota, { filtro: 'sin_vincular' }).map(f => f.clave))
      .toEqual(['v-4', 'gps-9']);
  });

  it('«sin vincular» incluye también las matrículas repetidas', () => {
    const conAmbigua = [...flota, entrada({ clave: 'v-5', ambigua: true })];
    expect(filtrarFlota(conAmbigua, { filtro: 'sin_vincular' }).map(f => f.clave))
      .toContain('v-5');
  });

  it('busca por matrícula aunque se escriba con espacios o guiones', () => {
    // En la ficha está guardada como `1234BCD`, pero quien la busca escribe
    // lo que le pilla el día.
    for (const q of ['1234 bcd', '1234-BCD', '1234bcd']) {
      expect(filtrarFlota(flota, { busqueda: q }).map(f => f.clave)).toEqual(['v-1']);
    }
  });

  it('busca por alias sin importar acentos ni mayúsculas', () => {
    const conAcento = [entrada({ clave: 'v-9', alias: 'Ambulancia Medicalizada Álava' })];
    expect(filtrarFlota(conAcento, { busqueda: 'alava' })).toHaveLength(1);
    expect(filtrarFlota(conAcento, { busqueda: 'ÁLAVA' })).toHaveLength(1);
  });

  it('busca por responsable de la asignación activa', () => {
    const conResponsable = [entrada({ asignacion: { responsable: 'Ana Ruiz' } })];
    expect(filtrarFlota(conResponsable, { busqueda: 'ruiz' })).toHaveLength(1);
  });

  it('combina filtro y búsqueda', () => {
    expect(filtrarFlota(flota, { filtro: 'movimiento', busqueda: '5555FFF' })).toHaveLength(0);
  });

  it('un filtro que no existe se comporta como «todos», no deja la lista vacía', () => {
    expect(filtrarFlota(flota, { filtro: 'lo-que-sea' })).toHaveLength(5);
  });

  it('sin argumentos no revienta', () => {
    expect(filtrarFlota()).toEqual([]);
  });
});

describe('contarPorFiltro', () => {
  it('cuenta cuántos hay de cada uno', () => {
    const conteos = contarPorFiltro([
      entrada({ estado: ESTADOS.MOVIMIENTO }),
      entrada({ clave: 'v-2', estado: ESTADOS.MOVIMIENTO }),
      entrada({ clave: 'v-3', estado: ESTADOS.SIN_GPS, vinculo: 'solo-app' }),
    ]);
    expect(conteos).toMatchObject({ todos: 3, movimiento: 2, sin_vincular: 1, apagados: 0 });
  });

  it('devuelve una clave por filtro aunque la lista esté vacía', () => {
    const conteos = contarPorFiltro([]);
    expect(Object.keys(conteos).sort()).toEqual(FILTROS.map(f => f.key).sort());
  });
});

describe('textoUltimoDato', () => {
  it('cuenta la antigüedad en palabras', () => {
    expect(textoUltimoDato(0)).toBe('ahora mismo');
    expect(textoUltimoDato(3)).toBe('hace 3 min');
    expect(textoUltimoDato(59)).toBe('hace 59 min');
    expect(textoUltimoDato(60)).toBe('hace 1 h');
    expect(textoUltimoDato(130)).toBe('hace 2 h 10 min');
    expect(textoUltimoDato(60 * 25)).toBe('hace 1 día');
    expect(textoUltimoDato(60 * 24 * 3)).toBe('hace 3 días');
  });

  it('sin fecha lo dice, en vez de callarse', () => {
    // Es lo que impide que un punto en el mapa se lea como «está ahí ahora».
    expect(textoUltimoDato(null)).toBe('sin fecha');
    expect(textoUltimoDato(undefined)).toBe('sin fecha');
  });
});

describe('textos de datos', () => {
  it('velocidad redondeada, o un guion si no la sabemos', () => {
    expect(textoVelocidad(53.6)).toBe('54 km/h');
    expect(textoVelocidad(0)).toBe('0 km/h');
    expect(textoVelocidad(null)).toBe('—');
  });

  it('kilómetros con separador de miles', () => {
    expect(textoKilometros(235400)).toBe('235.400 km');
    expect(textoKilometros(null)).toBe('—');
  });
});

describe('conPosicion', () => {
  it('solo los que se pueden pintar: sin coordenadas no hay marcador', () => {
    const lista = [
      entrada({ clave: 'v-1' }),
      entrada({ clave: 'v-2', gps: null }),
      entrada({ clave: 'v-3', gps: { lat: null, lng: null } }),
    ];
    expect(conPosicion(lista).map(f => f.clave)).toEqual(['v-1']);
    expect(conPosicion()).toEqual([]);
  });
});

describe('textoFuente', () => {
  it('distingue «no hay GPS aquí» de «el GPS no contesta»', () => {
    // La diferencia importa: una es que falta configurar el entorno y la otra
    // es una avería pasajera. Confundirlas manda a mirar donde no es.
    expect(textoFuente({ configurado: false })).toMatch(/Sin GPS configurado/);
    expect(textoFuente({ configurado: true, origen: 'ninguno' })).toBe('Cartrack no responde');
    expect(textoFuente({ configurado: true, origen: 'cache-vieja' })).toMatch(/última posición conocida/);
    expect(textoFuente({ configurado: true, origen: 'api' })).toBe('Datos en vivo');
    expect(textoFuente({ configurado: true, origen: 'cache' })).toBe('Datos en vivo');
  });

  it('sin fuente devuelve cadena vacía', () => {
    expect(textoFuente(null)).toBe('');
  });
});
