import { describe, it, expect } from 'vitest';
import {
  idsElegidos, usuariosDisponibles, miembrosIniciales, puedeAnadir,
  textoSolapes, resumenNombres, rolEnAsignacion, nombreMiembro,
} from '../../../utils/miembrosAsignacion.js';

const USERS = [
  { id: 1, nombre: 'Ana',  apellidos: 'Ruiz', activo: 1 },
  { id: 2, nombre: 'Luis', apellidos: 'Gil',  activo: 1 },
  { id: 3, nombre: 'Eva',  apellidos: 'Paz',  activo: 1 },
  { id: 4, nombre: 'Baja', apellidos: 'X',    activo: 0 },
];

describe('miembrosAsignacion', () => {
  it('idsElegidos descarta las filas sin rellenar', () => {
    expect(idsElegidos(['', 2, '3', null])).toEqual([2, 3]);
    expect(idsElegidos(undefined)).toEqual([]);
  });

  describe('usuariosDisponibles', () => {
    it('no ofrece a quien ya está en cualquiera de las dos listas', () => {
      expect(usuariosDisponibles(USERS, [1, 3], '').map(u => u.id)).toEqual([2]);
    });
    it('la fila conserva a su propio usuario', () => {
      expect(usuariosDisponibles(USERS, [1, 3], 3).map(u => u.id)).toEqual([2, 3]);
    });
    it('no ofrece usuarios inactivos', () => {
      expect(usuariosDisponibles(USERS, [], '').map(u => u.id)).not.toContain(4);
    });
  });

  describe('miembrosIniciales', () => {
    it('una asignación nueva arranca con una fila de responsable vacía y sin personal', () => {
      expect(miembrosIniciales(null)).toEqual({ responsables: [''], personal: [] });
    });
    it('una asignación completa trae sus dos listas', () => {
      expect(miembrosIniciales({
        user_id: 1, responsables: [{ id: 1 }, { id: 2 }], personal: [{ id: 3 }],
      })).toEqual({ responsables: [1, 2], personal: [3] });
    });
    it('la fila del listado (sin miembros) cae al responsable principal', () => {
      expect(miembrosIniciales({ user_id: 5 })).toEqual({ responsables: [5], personal: [] });
    });
  });

  it('puedeAnadir exige que todas las filas estén rellenas', () => {
    expect(puedeAnadir([1, 2])).toBe(true);
    expect(puedeAnadir([1, ''])).toBe(false);
    expect(puedeAnadir([])).toBe(true);
  });

  describe('textoSolapes', () => {
    it('sin solapes no hay aviso', () => {
      expect(textoSolapes([])).toBeNull();
      expect(textoSolapes(undefined)).toBeNull();
    });
    it('nombra a cada persona una vez', () => {
      expect(textoSolapes([{ nombre: 'Ana Ruiz' }, { nombre: 'Ana Ruiz' }]))
        .toBe('Aviso: Ana Ruiz ya tiene otra asignación en esas fechas');
      expect(textoSolapes([{ nombre: 'Ana Ruiz' }, { nombre: 'Luis Gil' }]))
        .toBe('Aviso: Ana Ruiz, Luis Gil ya tienen otra asignación en esas fechas');
    });
  });

  it('resumenNombres compacta la lista', () => {
    expect(resumenNombres('Ana Ruiz')).toBe('Ana Ruiz');
    expect(resumenNombres('Ana Ruiz, Luis Gil, Eva Paz')).toBe('Ana Ruiz +2');
    expect(resumenNombres(null)).toBeNull();
  });

  describe('rolEnAsignacion', () => {
    const asig = { user_id: 1, responsables: [{ id: 1 }, { id: 2 }], personal: [{ id: 3 }] };
    it('distingue responsable, personal y ajeno', () => {
      expect(rolEnAsignacion(asig, 2)).toBe('responsable');
      expect(rolEnAsignacion(asig, 3)).toBe('personal');
      expect(rolEnAsignacion(asig, 9)).toBeNull();
    });
    it('sin miembros cargados vale el responsable principal', () => {
      expect(rolEnAsignacion({ user_id: 1 }, 1)).toBe('responsable');
    });
    it('sin asignación o sin usuario no hay rol', () => {
      expect(rolEnAsignacion(null, 1)).toBeNull();
      expect(rolEnAsignacion(asig, undefined)).toBeNull();
    });
  });

  it('nombreMiembro usa el username si faltan nombre y apellidos', () => {
    expect(nombreMiembro({ nombre: 'Ana', apellidos: 'Ruiz' })).toBe('Ana Ruiz');
    expect(nombreMiembro({ username: 'aruiz' })).toBe('aruiz');
    expect(nombreMiembro(null)).toBe('');
  });
});
