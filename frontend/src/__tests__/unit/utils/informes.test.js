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

// Jornadas por día (v39)
import { textoAviso, tramosEvento } from '../../../utils/informes.js';

describe('informes con jornadas por día', () => {
  it('los avisos de jornada dicen cuántas, en singular o plural', () => {
    expect(textoAviso({ codigo: 'jornada_sin_iniciar', cuantas: 1 })).toBe('1 jornada sin iniciar: no suma horas');
    expect(textoAviso({ codigo: 'jornada_cerrada_sola', cuantas: 2 }))
      .toBe('2 jornadas sin «Fin de jornada» (se cerró sola): no suman horas');
    expect(textoAviso({ codigo: 'fin_jornada_pegado', minutos: 10 })).toContain('10 min');
    expect(textoAviso({ codigo: 'jornada_sin_fin' })).toBe('1 jornada sin terminar: no suma horas');
  });

  it('la columna del evento: un tramo, o una línea por jornada', () => {
    expect(tramosEvento({ llegada_servicio_at: '2026-10-05T06:30:00Z', fin_servicio_at: '2026-10-05T13:00:00Z' }))
      .toEqual(['08:30 – 15:00']);
    expect(tramosEvento({ jornadas: [
      { inicio: '2026-10-20T08:00:00Z', inicio_real_at: '2026-10-20T08:02:00Z', fin_real_at: '2026-10-20T18:00:00Z' },
      { inicio: '2026-10-21T08:00:00Z', inicio_real_at: '2026-10-21T08:00:00Z', fin_real_at: '2026-10-21T18:00:00Z', cierre_auto: true },
      { inicio: '2026-10-22T08:00:00Z', fin: '2026-10-22T18:00:00Z', inicio_real_at: null, fin_real_at: null },
    ] }, new Date('2026-10-23T00:00:00Z'))).toEqual(['20/10 10:02 – 20:00', '21/10 10:00 – 20:00 (se cerró sola)', '22/10 10:00–20:00 no consta']);
    expect(tramosEvento({ jornadas: [{ inicio: '2026-10-22T08:00:00Z', fin: '2026-10-22T18:00:00Z' }] },
      new Date('2026-10-22T09:00:00Z'))).toEqual(['22/10 10:00–20:00 pendiente']);
    // Con la asignación ya finalizada, la que no se fichó ya no llegará
    expect(tramosEvento({ estado: 'finalizada', jornadas: [{ inicio: '2026-10-22T08:00:00Z', fin: '2026-10-22T18:00:00Z' }] },
      new Date('2026-10-22T09:00:00Z'))).toEqual(['22/10 10:00–20:00 no consta']);
  });
});
