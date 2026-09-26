import { describe, it, expect } from 'vitest';
import { nombreMes, pct, por100, valorMetrica, variacion, fmt, fmtMin } from '../../../utils/informes.js';

describe('utils/informes', () => {
  it('nombreMes', () => {
    expect(nombreMes('2026-09')).toBe('septiembre de 2026');
    expect(nombreMes(null)).toBe('');
  });

  it('pct y por100: null sin denominador', () => {
    expect(pct(1, 8)).toBe(12.5);
    expect(pct(1, 0)).toBeNull();
    expect(pct(null, 5)).toBeNull();
    expect(por100(3, 150)).toBe(2);
  });

  it('valorMetrica tolera un resumen viejo sin el campo', () => {
    expect(valorMetrica('inicios_tardios', { inicios_tardios: 2, iniciados: 8 })).toBe(25);
    expect(valorMetrica('inc_nuevas', {})).toBeNull();
    expect(valorMetrica('inc_nuevas', null)).toBeNull();
  });

  it('variacion: en puntos para tasas, con sentido según la métrica', () => {
    const ahora = { servicios: 10, inicios_tardios: 1, iniciados: 10, con_llegada: 9 };
    const antes = { servicios: 10, inicios_tardios: 2, iniciados: 10, con_llegada: 5 };
    expect(variacion('inicios_tardios', ahora, antes)).toEqual({ diff: -10, texto: '−10 pt', sentido: 'mejor' });
    expect(variacion('con_llegada', ahora, antes)).toMatchObject({ texto: '+40 pt', sentido: 'mejor' });
    expect(variacion('inicios_tardios', antes, ahora).sentido).toBe('peor');
    expect(variacion('retraso_mediana', { retraso_mediana_min: 45 }, { servicios: 3, retraso_mediana_min: 40 }).texto).toBe('+5 min');
    expect(variacion('sin_iniciar', { sin_iniciar: 2 }, { servicios: 5, sin_iniciar: 2 })).toEqual({ diff: 0, texto: '=', sentido: 'igual' });
    expect(variacion('sin_iniciar', { sin_iniciar: 2 }, null)).toBeNull();
    // mes sin servicios: no hay con qué comparar
    expect(variacion('inc_nuevas', { servicios: 4, incidencias: { nuevas: 2 } }, { servicios: 0, incidencias: { nuevas: 0 } })).toBeNull();
  });

  it('fmt y fmtMin', () => {
    expect(fmt(null)).toBe('—');
    expect(fmt(12.5, ' %')).toBe('12,5 %');
    expect(fmtMin(null)).toBe('—');
    expect(fmtMin(20)).toBe('20 min');
    expect(fmtMin(120)).toBe('2 h');
    expect(fmtMin(95)).toBe('1 h 35 min');
  });
});
