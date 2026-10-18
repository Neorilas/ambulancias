import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { textoAviso, horasDudosas, totalesDetalle, tramo } from '../../../utils/informes.js';
import { nombreFicheroPdf, filasPdf, construirPdfTecnico } from '../../../utils/pdfInformeTecnico.js';

const servicio = (extra = {}) => ({
  asignacion_id: 1, trabajo: 'Feria', alias: 'Ambulancia 3', matricula: '1234ABC', rol: 'responsable',
  fecha_inicio: '2026-10-05T06:00:00Z', inicio_real_at: '2026-10-05T06:05:00Z',
  llegada_servicio_at: '2026-10-05T06:30:00Z', fin_servicio_at: '2026-10-05T13:00:00Z',
  finalizado_at: '2026-10-05T14:00:00Z', minutos_asignacion: 475, minutos_en_evento: 390, avisos: [], ...extra,
});

describe('utils/informes · detalle del técnico', () => {
  it('textoAviso: con minutos y tolerando un código desconocido', () => {
    expect(textoAviso({ codigo: 'sin_iniciar' })).toBe('Sin iniciar: no suma horas');
    expect(textoAviso({ codigo: 'fin_evento_pegado', minutos: 3 })).toContain('3 min antes de finalizar');
    expect(textoAviso({ codigo: 'inicio_tardio', minutos: 75 })).toBe('Inicio 1 h 15 min tarde');
    expect(textoAviso({ codigo: 'nuevo_del_backend' })).toBe('nuevo_del_backend');
  });

  it('horasDudosas solo con avisos graves', () => {
    expect(horasDudosas(servicio())).toBe(false);
    expect(horasDudosas(servicio({ avisos: [{ codigo: 'inicio_tardio', nivel: 'aviso' }] }))).toBe(false);
    expect(horasDudosas(servicio({ avisos: [{ codigo: 'evento_sin_fin', nivel: 'grave' }] }))).toBe(true);
  });

  it('totalesDetalle suma lo que hay y cuenta los dudosos', () => {
    const t = totalesDetalle([
      servicio(),
      servicio({ minutos_en_evento: null, avisos: [{ codigo: 'evento_sin_fin', nivel: 'grave' }] }),
      servicio({ avisos: [{ codigo: 'cierre_tardio', nivel: 'aviso', minutos: 40 }] }),
    ]);
    expect(t).toEqual({ servicios: 3, minutos_asignacion: 1425, minutos_en_evento: 780,
                        con_horas_dudosas: 1, con_avisos: 2 });
    // Sin nada medido, null («—»), no 0: un 0 parecería un dato (2026-10-18)
    expect(totalesDetalle()).toMatchObject({ servicios: 0, minutos_en_evento: null, minutos_asignacion: null });
    expect(totalesDetalle([servicio({ minutos_asignacion: null, minutos_en_evento: null })]))
      .toMatchObject({ minutos_asignacion: null, minutos_en_evento: null });
  });

  it('tramo en hora española, con el día si cambia y «sin …» si falta', () => {
    expect(tramo('2026-10-05T06:05:00Z', '2026-10-05T14:00:00Z')).toBe('08:05 – 16:00');
    expect(tramo('2026-10-05T20:00:00Z', '2026-10-06T00:30:00Z')).toBe('22:00 – 06/10 02:30');
    expect(tramo('2026-10-05T06:30:00Z', null)).toBe('08:30 – sin fin');
    expect(tramo(null, '2026-10-05T14:00:00Z')).toBe('sin inicio – 16:00');
    expect(tramo(null, null)).toBe('—');
  });
});

describe('utils/pdfInformeTecnico', () => {
  it('nombre del fichero sin tildes ni signos', () => {
    expect(nombreFicheroPdf({ nombre: 'José Núñez-Peña', mes: '2026-10' })).toBe('Horas_Jose_Nunez_Pena_2026-10.pdf');
    expect(nombreFicheroPdf({ nombre: '', mes: '2026-10' })).toBe('Horas_tecnico_2026-10.pdf');
  });

  it('filas: nivel por fila y los avisos en texto', () => {
    const [limpia, mala] = filasPdf([
      servicio({ trabajo: null }),
      servicio({ rol: 'personal', avisos: [{ codigo: 'sin_finalizar', nivel: 'grave' }] }),
    ]);
    expect(limpia.nivel).toBeNull();
    expect(limpia.celdas[1]).toBe('Asignación #1\nAmbulancia 3 (1234ABC)');
    expect(mala.nivel).toBe('grave');
    expect(mala.celdas[2]).toBe('Equipo');
    expect(mala.celdas[7]).toBe('Sin finalizar: no suma horas de asignación');
  });

  it('monta un PDF con el nombre, el mes y los totales', () => {
    const doc = construirPdfTecnico(jsPDF, autoTable, {
      mes: '2026-10', nombre: 'Ana Ruiz', en_curso: false, archivado: true,
      servicios: [servicio(), servicio({ asignacion_id: 2 })],
    });
    const texto = doc.output();
    expect(texto.startsWith('%PDF-')).toBe(true);
    expect(texto).toContain('Horas de Ana Ruiz');
    expect(texto).toContain('octubre de 2026');
    expect(texto).toContain('15 h 50 min');           // 2 × 7 h 55 min de asignación
    expect(texto).toContain('archivado');
  });

  it('sin servicios también genera el PDF', () => {
    const doc = construirPdfTecnico(jsPDF, autoTable, { mes: '2026-10', nombre: 'Ana', servicios: [] });
    // Con jornadas por día (v39): una línea por jornada en la columna del evento
    const conJornadas = construirPdfTecnico(jsPDF, autoTable, { mes: '2026-10', nombre: 'Ana', servicios: [{
      ...servicio(), estado: 'finalizada', minutos_en_evento: 600, minutos_asignacion: 600,
      jornadas: [
        { inicio: '2026-10-20T08:00:00Z', fin: '2026-10-20T18:00:00Z', inicio_real_at: '2026-10-20T08:00:00Z', fin_real_at: '2026-10-20T18:00:00Z' },
        { inicio: '2026-10-21T08:00:00Z', fin: '2026-10-21T18:00:00Z', inicio_real_at: null, fin_real_at: null },
      ],
      avisos: [{ codigo: 'jornada_sin_iniciar', nivel: 'grave', cuantas: 1 }],
    }] });
    expect(conJornadas.getNumberOfPages()).toBeGreaterThan(0);
    expect(filasPdf([{ ...servicio(), estado: 'finalizada', jornadas: [
      { inicio: '2026-10-21T08:00:00Z', fin: '2026-10-21T18:00:00Z', inicio_real_at: null, fin_real_at: null }] }])[0]
      .celdas[3]).toBe('21/10 10:00–20:00 no consta');
    expect(doc.output()).toContain('No tuvo servicios este mes.');
  });
});
