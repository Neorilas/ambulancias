import { describe, it, expect } from 'vitest';
import { evaluarEncuadre, TIPOS_CON_ENCUADRE } from '../../../utils/encuadreVehiculo.js';

// Imagen de 512x288 (lado largo del análisis). bbox = [x, y, ancho, alto].
const W = 512, H = 288;
const det = (bbox, cls = 'truck', score = 0.8) => ({ class: cls, score, bbox });
const codigos = (dets, tipo = 'lateral_izquierdo') => evaluarEncuadre(dets, W, H, tipo).map(a => a.codigo);

describe('evaluarEncuadre', () => {
  it('solo aplica a las cuatro fotos exteriores', () => {
    expect(TIPOS_CON_ENCUADRE).toEqual(['frontal', 'trasera', 'lateral_izquierdo', 'lateral_derecho']);
    expect(evaluarEncuadre([], W, H, 'cuentakilometros')).toEqual([]);
    expect(evaluarEncuadre([], W, H, 'danos')).toEqual([]);
  });

  it('ambulancia entera, grande y con margen: sin avisos', () => {
    expect(codigos([det([30, 40, 450, 200])])).toEqual([]);
  });

  it('sin ningún vehículo avisa', () => {
    expect(codigos([])).toEqual(['sin_vehiculo']);
    expect(codigos(null)).toEqual(['sin_vehiculo']);
  });

  it('ignora lo que no es vehículo y las detecciones poco seguras', () => {
    expect(codigos([det([30, 40, 450, 200], 'person'), det([30, 40, 450, 200], 'truck', 0.1)])).toEqual(['sin_vehiculo']);
  });

  it('una ambulancia puede salir como car, truck o bus', () => {
    for (const cls of ['car', 'truck', 'bus']) expect(codigos([det([30, 40, 450, 200], cls)])).toEqual([]);
  });

  it('cortada por un lado lo dice', () => {
    const [aviso] = evaluarEncuadre([det([0, 40, 450, 200])], W, H, 'lateral_izquierdo');
    expect(aviso.codigo).toBe('cortada');
    expect(aviso.titulo).toBe('La ambulancia sale cortada por la izquierda');
  });

  it('cortada por varios lados los enumera', () => {
    const [aviso] = evaluarEncuadre([det([40, 0, 472, 288])], W, H, 'frontal');
    expect(aviso.titulo).toBe('La ambulancia sale cortada por la derecha, arriba y abajo');
  });

  it('tocando los dos lados es que no cabe: demasiado cerca', () => {
    expect(codigos([det([0, 30, 512, 220])])).toEqual(['cerca']);
  });

  it('en un lateral, pequeña es que no llena el ancho', () => {
    expect(codigos([det([150, 60, 200, 150])])).toEqual(['lejos']);
  });

  it('de frente, pequeña es que ocupa poca superficie', () => {
    expect(codigos([det([200, 100, 100, 100])], 'frontal')).toEqual(['lejos']);
    // alta y estrecha, como se ve una ambulancia de frente: bien
    expect(codigos([det([150, 20, 200, 250])], 'trasera')).toEqual([]);
  });

  // Otra ambulancia aparcada al lado: manda la grande, que es la que se fotografía.
  it('con varios vehículos juzga el más grande', () => {
    expect(codigos([det([0, 100, 60, 80], 'car'), det([80, 40, 400, 200])])).toEqual([]);
  });
});
