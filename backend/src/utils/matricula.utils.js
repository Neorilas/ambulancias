/**
 * utils/matricula.utils.js
 * Normalización y validación de matrículas de vehículo.
 *
 * Contexto: al dar de alta la flota se rellenó el campo `matricula` con el
 * nombre de la ambulancia y el campo `alias` con la matrícula, es decir
 * cruzados. Estas funciones son la base tanto de la corrección de datos
 * (migración v14) como de la validación de altas/ediciones, para que el
 * cruce no pueda repetirse.
 *
 * Formatos aceptados (España):
 *   - Actual (desde 2000): 1234 BCD   — 4 dígitos + 3 consonantes
 *   - Anterior:            M 1234 AB  — 1-2 letras de provincia + 4 dígitos + 0-2 letras
 * Los separadores (espacios, guiones) son opcionales y se descartan al
 * normalizar, de modo que "1234 BCD", "1234-BCD" y "1234bcd" son la misma.
 */

'use strict';

// Consonantes usadas en las matrículas actuales (sin vocales ni Ñ, Q)
const RE_ACTUAL  = /^[0-9]{4}[BCDFGHJKLMNPRSTVWXYZ]{3}$/;
const RE_ANTIGUA = /^[A-Z]{1,2}[0-9]{4}[A-Z]{0,2}$/;

/** Forma canónica: sin separadores ni espacios, en mayúsculas. */
function normalizarMatricula(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor).toUpperCase().replace(/[\s.\-_]/g, '');
}

/** ¿El texto tiene forma de matrícula española (actual o antigua)? */
function esMatricula(valor) {
  const m = normalizarMatricula(valor);
  return RE_ACTUAL.test(m) || RE_ANTIGUA.test(m);
}

/**
 * ¿Este par (matricula, alias) está cruzado?
 * Solo lo afirmamos cuando no hay ambigüedad: el alias tiene forma de
 * matrícula y la matrícula no. Si ambos o ninguno la tienen, no se toca.
 */
function estaCruzado(matricula, alias) {
  return esMatricula(alias) && !esMatricula(matricula);
}

/**
 * Saca la matrícula de un texto que puede traerla pegada a otras cosas.
 *
 * Nació por Cartrack: su campo `registration` NO es la matrícula, es el nombre
 * del vehículo y la matrícula juntos — `UVI-3-7740MZB`, `VIR-01-7950KGG`,
 * `VAL- 2066JSC`. Normalizando el texto entero, `UVI-3-7740MZB` se convierte en
 * `UVI37740MZB` y no cruza con el `7740MZB` de nuestra ficha: la sonda de fase
 * 0 cruzó 0 de 10 vehículos por esto exactamente.
 *
 * El orden de los intentos importa:
 *   1. ¿El texto entero ya es una matrícula? (`1234 BCD` → `1234BCD`).
 *   2. Si no, se parte por los separadores y se buscan matrículas DE DERECHA A
 *      IZQUIERDA: la matrícula va al final y el nombre delante.
 *   3. Si tampoco (no había separador que valiera), se busca una matrícula del
 *      formato actual pegada al final del texto ya normalizado.
 * Si nada encaja se devuelve el texto normalizado tal cual, para que al menos
 * se vea algo en pantalla y se pueda diagnosticar.
 *
 * No tiene espejo en el frontend a propósito: el navegador nunca ve el texto
 * crudo de Cartrack, le llega ya resuelto desde el backend.
 */
function extraerMatricula(valor) {
  const entero = normalizarMatricula(valor);
  if (!entero) return '';
  if (esMatricula(entero)) return entero;

  const trozos = String(valor).split(/[\s.\-_]+/).filter(Boolean);
  for (let i = trozos.length - 1; i >= 0; i--) {
    const t = normalizarMatricula(trozos[i]);
    if (esMatricula(t)) return t;
  }

  const alFinal = entero.match(new RegExp(RE_ACTUAL.source.replace(/^\^/, '').replace(/\$$/, '') + '$'));
  if (alFinal) return alFinal[0];

  return entero;
}

const MENSAJE_FORMATO =
  'Formato de matrícula no válido. Se espera 1234BCD o M1234AB. ' +
  'El nombre de la ambulancia va en el campo Nombre.';

module.exports = {
  normalizarMatricula,
  extraerMatricula,
  esMatricula,
  estaCruzado,
  MENSAJE_FORMATO,
  RE_ACTUAL,
  RE_ANTIGUA,
};
