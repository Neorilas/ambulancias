import { describe, it, expect, beforeEach } from 'vitest';
import {
  CLAVE_ATENDIDAS,
  claveAlarma,
  leerAtendidas,
  marcarAtendidas,
  alarmasPendientes,
  etiquetaVehiculo,
  etiquetaResponsables,
  minutosDeRetraso,
} from '../../../utils/alarmaSinIniciar.js';
import { getItem, setItem, clear } from '../../../utils/sessionStorage.js';

const A = { id: 1, aviso_sin_iniciar_at: '2026-09-25T08:15:00.000Z' };
const B = { id: 2, aviso_sin_iniciar_at: '2026-09-25T09:15:00.000Z' };

describe('alarmaSinIniciar', () => {
  beforeEach(() => clear());

  it('la clave junta asignación y momento del aviso', () => {
    expect(claveAlarma(A)).toBe('1@2026-09-25T08:15:00.000Z');
    expect(claveAlarma({ id: 3 })).toBe('3@');
  });

  it('sin nada guardado, todas las alarmas suenan', () => {
    expect(alarmasPendientes([A, B])).toEqual([A, B]);
    expect(alarmasPendientes(null)).toEqual([]);
  });

  it('«Enterado» silencia en este dispositivo solo las atendidas', () => {
    marcarAtendidas([A], [A, B]);
    expect(alarmasPendientes([A, B])).toEqual([B]);
  });

  it('si la asignación se aplaza y vuelve a vencer, es alarma nueva y suena otra vez', () => {
    marcarAtendidas([A], [A]);
    const reAvisada = { ...A, aviso_sin_iniciar_at: '2026-09-25T11:15:00.000Z' };
    expect(alarmasPendientes([reAvisada])).toEqual([reAvisada]);
  });

  it('olvida lo atendido que ya no está vigente (no crece sin fin)', () => {
    marcarAtendidas([A], [A, B]);
    marcarAtendidas([B], [B]);   // A ya se inició: no vuelve
    expect(JSON.parse(getItem(CLAVE_ATENDIDAS))).toEqual([claveAlarma(B)]);
  });

  it('marcar sin listas no rompe', () => {
    marcarAtendidas(undefined, undefined);
    expect(leerAtendidas().size).toBe(0);
  });

  it('un valor corrupto guardado vale por vacío', () => {
    setItem(CLAVE_ATENDIDAS, '{no es json');
    expect(leerAtendidas().size).toBe(0);
    setItem(CLAVE_ATENDIDAS, '{"a":1}');
    expect(leerAtendidas().size).toBe(0);
    setItem(CLAVE_ATENDIDAS, '["1@x", 7]');
    expect([...leerAtendidas()]).toEqual(['1@x']);
  });

  it('nombra el vehículo por alias, luego matrícula', () => {
    expect(etiquetaVehiculo({ vehiculo_alias: 'Alfa 1', matricula: '1234ABC' })).toBe('Alfa 1');
    expect(etiquetaVehiculo({ matricula: '1234ABC' })).toBe('1234ABC');
    expect(etiquetaVehiculo(null)).toBe('Vehículo sin identificar');
  });

  it('nombra a los responsables', () => {
    expect(etiquetaResponsables({ responsables_nombres: 'Ana, Luis', responsable_nombre: 'Ana' })).toBe('Ana, Luis');
    expect(etiquetaResponsables({ responsable_nombre: 'Ana' })).toBe('Ana');
    expect(etiquetaResponsables(undefined)).toBe('Sin responsable');
  });

  it('minutos de retraso: enteros, nunca negativos, 0 si la fecha no vale', () => {
    const ahora = new Date('2026-09-25T08:20:30Z');
    expect(minutosDeRetraso('2026-09-25T08:00:00Z', ahora)).toBe(20);
    expect(minutosDeRetraso('2026-09-25T09:00:00Z', ahora)).toBe(0);
    expect(minutosDeRetraso('no es fecha', ahora)).toBe(0);
    expect(minutosDeRetraso('2026-09-25T08:00:00Z')).toBeGreaterThan(0);
  });
});
