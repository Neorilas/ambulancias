import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  UMBRALES,
  calcProximaITV,
  calcProximaITS,
  diasHasta,
  TIPO_LABEL,
  thresholdFor,
  thresholdStyle,
  dismissKey,
  isDismissed,
  markDismissed,
  unmarkDismissed,
  pruneDismissals,
  listDismissals,
  clearAllDismissals,
  withThresholds,
} from '../../../utils/vehicleAlerts';

/** Fecha local, para que la zona horaria del runner no mueva el día. */
const local = (y, m, d) => new Date(y, m - 1, d);
/** Compara solo el día natural, que es lo que le importa a la alerta. */
const ymd = (fecha) => [fecha.getFullYear(), fecha.getMonth() + 1, fecha.getDate()];

describe('vehicleAlerts', () => {
  describe('calcProximaITV', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(local(2026, 9, 20));
    });
    afterEach(() => vi.useRealTimers());

    it('sin última ITV no hay próxima que calcular', () => {
      expect(calcProximaITV(local(2020, 1, 1), null)).toBeNull();
      expect(calcProximaITV(null, undefined)).toBeNull();
    });

    it('vehículo de 5 años o más: revisión semestral', () => {
      const proxima = calcProximaITV(local(2020, 1, 1), local(2026, 3, 15));
      expect(ymd(proxima)).toEqual([2026, 9, 15]);
    });

    it('vehículo de menos de 5 años: revisión anual', () => {
      const proxima = calcProximaITV(local(2024, 1, 1), local(2026, 3, 15));
      expect(ymd(proxima)).toEqual([2027, 3, 15]);
    });

    it('sin fecha de matriculación asume el intervalo anual', () => {
      const proxima = calcProximaITV(null, local(2026, 3, 15));
      expect(ymd(proxima)).toEqual([2027, 3, 15]);
    });

    it('pasados los 5 años ya cuenta como semestral', () => {
      const proxima = calcProximaITV(local(2021, 9, 19), local(2026, 3, 15));
      expect(ymd(proxima)).toEqual([2026, 9, 15]);
    });

    it('un día antes de los 5 años sigue siendo anual', () => {
      const proxima = calcProximaITV(local(2021, 9, 21), local(2026, 3, 15));
      expect(ymd(proxima)).toEqual([2027, 3, 15]);
    });

    it('GOTCHA: si el día no existe en el mes destino, setMonth desborda al siguiente', () => {
      // 31/08 + 6 meses = 31/02, que no existe, y JS lo pasa a marzo.
      const proxima = calcProximaITV(local(2020, 1, 1), local(2026, 8, 31));
      expect(ymd(proxima)).toEqual([2027, 3, 3]);
    });
  });

  describe('calcProximaITS', () => {
    it('sin última ITS devuelve null', () => {
      expect(calcProximaITS(null)).toBeNull();
      expect(calcProximaITS('')).toBeNull();
    });

    it('es anual desde la última realizada', () => {
      expect(ymd(calcProximaITS(local(2026, 3, 15)))).toEqual([2027, 3, 15]);
    });

    it('un 29 de febrero bisiesto cae en el 1 de marzo del año siguiente', () => {
      expect(ymd(calcProximaITS(local(2024, 2, 29)))).toEqual([2025, 3, 1]);
    });
  });

  describe('diasHasta', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(local(2026, 9, 20));
    });
    afterEach(() => vi.useRealTimers());

    it('sin fecha devuelve null', () => {
      expect(diasHasta(null)).toBeNull();
      expect(diasHasta(undefined)).toBeNull();
    });

    it('cuenta los días que faltan', () => {
      expect(diasHasta(local(2026, 9, 25))).toBe(5);
    });

    it('hoy mismo son 0 días', () => {
      expect(diasHasta(local(2026, 9, 20))).toBe(0);
    });

    it('una fecha pasada da negativo: está vencida', () => {
      expect(diasHasta(local(2026, 9, 18))).toBe(-2);
    });
  });

  describe('thresholdFor', () => {
    it('días negativos: vencida', () => {
      expect(thresholdFor(-1)).toBe('vencida');
      expect(thresholdFor(-90)).toBe('vencida');
    });

    it('asigna el umbral más cercano por arriba', () => {
      expect(thresholdFor(0)).toBe(15);
      expect(thresholdFor(15)).toBe(15);
      expect(thresholdFor(16)).toBe(30);
      expect(thresholdFor(30)).toBe(30);
      expect(thresholdFor(31)).toBe(45);
      expect(thresholdFor(45)).toBe(45);
      expect(thresholdFor(46)).toBe(60);
      expect(thresholdFor(60)).toBe(60);
    });

    it('más de 60 días todavía no es alerta', () => {
      expect(thresholdFor(61)).toBeNull();
      expect(thresholdFor(365)).toBeNull();
    });

    it('todos los UMBRALES publicados se devuelven tal cual', () => {
      UMBRALES.forEach(u => expect(thresholdFor(u)).toBe(u));
    });

    it('sin días no hay umbral: nada de alertas fantasma', () => {
      // `null <= 15` es cierto en JS, así que esto devolvía 15 y pintaba
      // «quedan 15 días» sobre un documento sin fecha conocida.
      expect(thresholdFor(null)).toBeNull();
      expect(thresholdFor(undefined)).toBeNull();
    });

    it('un valor que no es un número tampoco genera alerta', () => {
      expect(thresholdFor('20')).toBeNull();
      expect(thresholdFor('')).toBeNull();
      expect(thresholdFor(NaN)).toBeNull();
      expect(thresholdFor(Infinity)).toBeNull();
      expect(thresholdFor(-Infinity)).toBeNull();
      expect(thresholdFor({})).toBeNull();
      expect(thresholdFor([])).toBeNull();
      expect(thresholdFor(false)).toBeNull();
    });
  });

  describe('thresholdStyle', () => {
    it('vencida va en rojo', () => {
      expect(thresholdStyle('vencida').badge).toBe('badge-red');
    });

    it('15 y 30 días van en ámbar', () => {
      expect(thresholdStyle(15).badge).toBe('badge-yellow');
      expect(thresholdStyle(30).badge).toBe('badge-yellow');
    });

    it('45 y 60 días van en azul: es un aviso lejano', () => {
      expect(thresholdStyle(45).badge).toBe('badge-blue');
      expect(thresholdStyle(60).badge).toBe('badge-blue');
    });

    it('un umbral desconocido cae en el gris neutro', () => {
      expect(thresholdStyle(null).badge).toBe('badge-gray');
      expect(thresholdStyle(999).badge).toBe('badge-gray');
    });

    it('siempre devuelve las tres piezas de estilo', () => {
      ['vencida', 15, 30, 45, 60, null].forEach(t => {
        const s = thresholdStyle(t);
        expect(s).toEqual(expect.objectContaining({
          bg: expect.any(String), text: expect.any(String), badge: expect.any(String),
        }));
      });
    });
  });

  it('TIPO_LABEL cubre los tres documentos que caducan', () => {
    expect(TIPO_LABEL).toEqual({
      itv: 'ITV', its: 'ITS', tarjeta_transporte: 'Tarjeta de transporte',
    });
  });

  describe('descartes en localStorage', () => {
    const alerta = { vehicle_id: 7, tipo: 'itv', threshold: 30 };

    beforeEach(() => localStorage.clear());

    it('la clave lleva vehículo, tipo y umbral', () => {
      expect(dismissKey(alerta)).toBe('alert_dismissed:7:itv:30');
    });

    it('marcar y leer el descarte', () => {
      expect(isDismissed(alerta)).toBe(false);
      markDismissed(alerta);
      expect(isDismissed(alerta)).toBe(true);
    });

    it('al cruzar el siguiente umbral la alerta vuelve a aparecer', () => {
      markDismissed(alerta);
      // Misma alerta, pero ya a 15 días: es otra clave, así que no está descartada.
      expect(isDismissed({ ...alerta, threshold: 15 })).toBe(false);
    });

    it('el descarte no se contagia entre vehículos ni entre tipos', () => {
      markDismissed(alerta);
      expect(isDismissed({ ...alerta, vehicle_id: 8 })).toBe(false);
      expect(isDismissed({ ...alerta, tipo: 'its' })).toBe(false);
    });

    it('unmarkDismissed lo deshace', () => {
      markDismissed(alerta);
      unmarkDismissed(alerta);
      expect(isDismissed(alerta)).toBe(false);
    });

    it('listDismissals solo devuelve las claves del sistema de alertas', () => {
      markDismissed(alerta);
      markDismissed({ vehicle_id: 8, tipo: 'its', threshold: 'vencida' });
      localStorage.setItem('vapss:produccion:accessToken', 'xxx');
      expect(listDismissals().sort()).toEqual([
        'alert_dismissed:7:itv:30',
        'alert_dismissed:8:its:vencida',
      ]);
    });

    it('clearAllDismissals no toca las claves ajenas', () => {
      markDismissed(alerta);
      localStorage.setItem('vapss:produccion:accessToken', 'xxx');
      clearAllDismissals();
      expect(listDismissals()).toEqual([]);
      expect(localStorage.getItem('vapss:produccion:accessToken')).toBe('xxx');
    });

    it('pruneDismissals borra los descartes sin alerta viva detrás', () => {
      markDismissed(alerta);
      markDismissed({ vehicle_id: 8, tipo: 'its', threshold: 60 });
      localStorage.setItem('vapss:produccion:user', '{}');

      pruneDismissals([alerta]);

      expect(listDismissals()).toEqual(['alert_dismissed:7:itv:30']);
      expect(localStorage.getItem('vapss:produccion:user')).toBe('{}');
    });

    it('pruneDismissals con la lista vacía deja el storage de alertas limpio', () => {
      markDismissed(alerta);
      pruneDismissals([]);
      expect(listDismissals()).toEqual([]);
    });

    it('si localStorage está bloqueado, nada revienta', () => {
      const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage bloqueado');
      });
      expect(isDismissed(alerta)).toBe(false);
      getSpy.mockRestore();

      const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('cuota llena');
      });
      expect(() => markDismissed(alerta)).not.toThrow();
      setSpy.mockRestore();

      const rmSpy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('bloqueado');
      });
      expect(() => unmarkDismissed(alerta)).not.toThrow();
      expect(() => clearAllDismissals()).not.toThrow();
      expect(() => pruneDismissals([])).not.toThrow();
      rmSpy.mockRestore();
    });
  });

  describe('withThresholds', () => {
    it('sin alertas devuelve una lista vacía', () => {
      expect(withThresholds(null)).toEqual([]);
      expect(withThresholds(undefined)).toEqual([]);
      expect(withThresholds([])).toEqual([]);
    });

    it('añade el umbral y conserva el resto del registro', () => {
      const [a] = withThresholds([{ vehicle_id: 3, tipo: 'itv', dias_restantes: 20 }]);
      expect(a).toEqual({ vehicle_id: 3, tipo: 'itv', dias_restantes: 20, threshold: 30 });
    });

    it('descarta lo que aún no entra en ningún umbral', () => {
      const out = withThresholds([
        { vehicle_id: 1, dias_restantes: 90 },
        { vehicle_id: 2, dias_restantes: 10 },
        { vehicle_id: 3, dias_restantes: -5 },
      ]);
      expect(out.map(a => [a.vehicle_id, a.threshold])).toEqual([[2, 15], [3, 'vencida']]);
    });

    it('filtra las entradas sin días: no se cuela una alerta de un documento sin fecha', () => {
      const out = withThresholds([
        { vehicle_id: 1, tipo: 'itv', dias_restantes: null },
        { vehicle_id: 2, tipo: 'its' },                       // sin el campo
        { vehicle_id: 3, tipo: 'itv', dias_restantes: 10 },
      ]);
      expect(out.map(a => a.vehicle_id)).toEqual([3]);
    });

    it('no muta el array que llega del backend', () => {
      const origen = [{ vehicle_id: 1, dias_restantes: 10 }];
      withThresholds(origen);
      expect(origen[0]).not.toHaveProperty('threshold');
    });
  });
});
