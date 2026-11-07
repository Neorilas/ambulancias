'use strict';

/**
 * Guarda de la v43 (asignaciones de solo personal, `vehicle_id` NULL).
 *
 * La trampa: un `JOIN vehicles` (INNER) sobre una asignación hace
 * desaparecer en silencio las de solo personal: no salen en el trabajo, el
 * cron no las activa, nadie avisa de «sin iniciar» y no suman horas en el
 * informe. Ningún test de esas consultas lo ve, porque los mocks devuelven lo
 * que se les dice. Este mira el código: todo JOIN de una asignación con su
 * vehículo tiene que ser LEFT, salvo los de la lista, que excluyen a
 * propósito lo que no tiene vehículo.
 */

const fs   = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '../../../..');

// Ficheros con un INNER JOIN que SÍ quiere dejar fuera lo que no tiene
// vehículo, con el motivo
const PERMITIDOS = {
  // getRecorrido: el GPS es del vehículo; una de solo personal da 404
  'src/controllers/flota.controller.js': 1,
};

function fuentes(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : fuentes(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

describe('v43: ningún INNER JOIN de una asignación con su vehículo', () => {
  const ficheros = [...fuentes(path.join(RAIZ, 'src')), path.join(RAIZ, 'server.js')];
  // `JOIN vehicles v ON v.id = al.vehicle_id` o al revés, con alias al/a,
  // y que no lleve LEFT delante
  const INNER = /(?<!LEFT\s)JOIN\s+vehicles\s+v\s+ON\s+(?:v\.id\s*=\s*(?:al|a)\.vehicle_id|(?:al|a)\.vehicle_id\s*=\s*v\.id)/g;

  it.each(ficheros.map(f => [path.relative(RAIZ, f), f]))('%s', (rel, fichero) => {
    const encontrados = (fs.readFileSync(fichero, 'utf8').match(INNER) || []).length;
    expect(encontrados).toBe(PERMITIDOS[rel] || 0);
  });
});
