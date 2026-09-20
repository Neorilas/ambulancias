'use strict';

/**
 * Tests de utils/matricula.utils.js
 *
 * El resto del fichero se ejercita de rebote desde `vehicles.controller`; lo
 * que se fija aquí es `extraerMatricula`, que nació de un fallo concreto y
 * merece sus propios casos: la sonda de fase 0 cruzó **0 de 10** vehículos
 * porque el campo `registration` de Cartrack no es la matrícula, es el nombre
 * del vehículo con la matrícula pegada detrás.
 */

const {
  extraerMatricula,
  normalizarMatricula,
  esMatricula,
  estaCruzado,
} = require('../../../utils/matricula.utils');

describe('extraerMatricula', () => {
  it('saca la matrícula de los nombres REALES de la flota en Cartrack', () => {
    // Copiados tal cual de la respuesta de la API el 2026-09-20.
    const reales = {
      'UVI-3-7740MZB':  '7740MZB',
      'UVI-2-4669LTT':  '4669LTT',
      'UVI-7-2286NPP':  '2286NPP',
      'VIR-01-7950KGG': '7950KGG',
      'SVB-01-8588KCY': '8588KCY',
      'UVI-6-6732NFT':  '6732NFT',
      'UVI-5-1071NBV':  '1071NBV',
      'UVI-4-5626MTR':  '5626MTR',
      'VAL- 2066JSC':   '2066JSC',   // ojo: guion Y espacio
      'UVI-1-8095KYG':  '8095KYG',
    };
    for (const [entrada, esperada] of Object.entries(reales)) {
      expect(extraerMatricula(entrada)).toBe(esperada);
    }
  });

  it('una matrícula a secas se normaliza y ya', () => {
    expect(extraerMatricula('1234BCD')).toBe('1234BCD');
    expect(extraerMatricula('1234 BCD')).toBe('1234BCD');   // el texto entero vale
    expect(extraerMatricula('1234-bcd')).toBe('1234BCD');
    expect(extraerMatricula('M1234AB')).toBe('M1234AB');    // formato antiguo
  });

  it('también la encuentra si no hay ningún separador', () => {
    // Es el tercer intento: buscar el formato actual pegado al final.
    expect(extraerMatricula('UVI37740MZB')).toBe('7740MZB');
  });

  it('sin matrícula dentro devuelve el texto normalizado, no una cadena vacía', () => {
    // Así al menos se ve algo en la lista de «sin vincular» y se puede
    // diagnosticar, en vez de una fila fantasma sin nada que buscar.
    expect(extraerMatricula('sin matricula')).toBe('SINMATRICULA');
  });

  it('con nada devuelve cadena vacía', () => {
    expect(extraerMatricula(null)).toBe('');
    expect(extraerMatricula(undefined)).toBe('');
    expect(extraerMatricula('')).toBe('');
    expect(extraerMatricula('   ')).toBe('');
  });

  it('lo que devuelve es una matrícula válida siempre que hubiera una', () => {
    for (const t of ['UVI-3-7740MZB', 'VAL- 2066JSC', '1234 BCD']) {
      expect(esMatricula(extraerMatricula(t))).toBe(true);
    }
  });
});

describe('normalizarMatricula y esMatricula', () => {
  it('la forma canónica va sin separadores y en mayúsculas', () => {
    expect(normalizarMatricula(' 1234-b c d ')).toBe('1234BCD');
    expect(normalizarMatricula(null)).toBe('');
  });

  it('acepta los dos formatos españoles y rechaza lo demás', () => {
    expect(esMatricula('1234BCD')).toBe(true);
    expect(esMatricula('M1234AB')).toBe(true);
    expect(esMatricula('1234AEI')).toBe(false);   // vocales: no son de matrícula actual
    expect(esMatricula('Ambulancia 1')).toBe(false);
  });
});

describe('estaCruzado', () => {
  it('solo lo afirma cuando no hay duda', () => {
    // El alias tiene forma de matrícula y la matrícula no: están del revés.
    expect(estaCruzado('Ambulancia 1', '1234BCD')).toBe(true);
    // Los dos la tienen, o ninguno: no se toca nada.
    expect(estaCruzado('1234BCD', '5555FFF')).toBe(false);
    expect(estaCruzado('Ambulancia 1', 'UVI 3')).toBe(false);
  });
});
