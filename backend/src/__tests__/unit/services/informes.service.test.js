'use strict';

/**
 * Tests de services/informes.service.js
 *
 * Lo que importa: que el mes se corte en hora española, que el inicio tardío
 * sea «más de 30 min», que el personal no cargue con el retraso, que un mes
 * archivado mande sobre el cálculo en vivo y que archivar solo toque meses
 * cerrados y sin fila.
 */

const { query } = require('../../../config/database');
const inf = require('../../../services/informes.service');

const AHORA = new Date('2026-09-27T10:00:00.000Z');
const d = (iso) => new Date(iso);

/** Asignación de septiembre de 2026 (08:00 España = 06:00 UTC). */
function asig(extra = {}) {
  return {
    id: 1, vehicle_id: 10, estado: 'finalizada', alias: 'Ambulancia 10', matricula: '1010AAA',
    fecha_inicio: d('2026-09-10T06:00:00Z'), fecha_fin: d('2026-09-10T14:00:00Z'),
    inicio_real_at: d('2026-09-10T06:05:00Z'), llegada_servicio_at: null,
    finalizado_at: d('2026-09-10T14:00:00Z'), km_inicio: 1000, km_fin: 1120,
    fotos_inicio_tarde: 0, ...extra,
  };
}

/** BD falsa: responde según la consulta. */
function bd({ asignaciones = [], miembros = [], flota = [], incidencias = [], archivados = {} } = {}) {
  query.mockReset();
  query.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM asignacion_usuarios')) return [miembros];
    if (sql.includes('FROM asignaciones_libres al')) return [asignaciones];
    if (sql.includes('FROM vehicles WHERE deleted_at')) return [flota];
    if (sql.includes('FROM vehicle_incidencias')) return [incidencias];
    if (sql.startsWith('SELECT datos')) {
      const a = archivados[params[0]];
      return [a ? [{ datos: a, generado_at: AHORA }] : []];
    }
    if (sql.startsWith('SELECT mes FROM informe_mensual')) {
      return [params.filter(m => archivados[m]).map(mes => ({ mes }))];
    }
    return [{ affectedRows: 1 }];
  });
}

describe('informes.service · meses', () => {
  it('mesDe usa el calendario español: el 30 a las 23:30 UTC ya es el mes siguiente', () => {
    expect(inf.mesDe(d('2026-09-30T23:30:00Z'))).toBe('2026-10');
    expect(inf.mesDe(d('2026-09-30T21:30:00Z'))).toBe('2026-09');
  });

  it('mesDesplazado cruza años', () => {
    expect(inf.mesDesplazado('2026-01', -1)).toBe('2025-12');
    expect(inf.mesDesplazado('2026-09', -12)).toBe('2025-09');
    expect(inf.mesDesplazado('2025-12', 1)).toBe('2026-01');
  });

  it('limitesMes da la medianoche española (verano +2, invierno +1)', () => {
    const { desde, hasta } = inf.limitesMes('2026-10');
    expect(desde.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(hasta.toISOString()).toBe('2026-10-31T23:00:00.000Z');
  });

  it('esMes valida el formato', () => {
    expect(inf.esMes('2026-09')).toBe(true);
    expect(inf.esMes('2026-13')).toBe(false);
    expect(inf.esMes('2026-9')).toBe(false);
    expect(inf.esMes(undefined)).toBe(false);
  });

  it('mediana', () => {
    expect(inf.mediana([])).toBeNull();
    expect(inf.mediana([5, 1, 3])).toBe(3);
    expect(inf.mediana([1, 2, 3, 10])).toBe(3);
  });
});

describe('informes.service · calcularInforme', () => {
  it('filtra por el mes (fechas españolas) y excluye canceladas y borradas', async () => {
    bd();
    await inf.calcularInforme('2026-09', AHORA);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("al.estado <> 'cancelada'");
    expect(sql).toContain('al.deleted_at IS NULL');
    expect(params[1].toISOString()).toBe('2026-08-31T22:00:00.000Z');
    expect(params[2].toISOString()).toBe('2026-09-30T22:00:00.000Z');
  });

  it('inicio tardío es MÁS de 30 min; 30 justos no cuenta', async () => {
    bd({ asignaciones: [
      asig({ id: 1, inicio_real_at: d('2026-09-10T06:30:00Z') }),
      asig({ id: 2, inicio_real_at: d('2026-09-10T06:31:00Z') }),
      asig({ id: 3, inicio_real_at: d('2026-09-10T07:40:00Z') }),
    ] });
    const r = await inf.calcularInforme('2026-09', AHORA);
    expect(r.umbral_min).toBe(30);
    expect(r.resumen).toMatchObject({
      servicios: 3, iniciados: 3, inicios_tardios: 2, retraso_mediana_min: 66, retraso_medio_min: 66,
    });
  });

  it('sin iniciar: solo si ya pasó el margen (en el mes en curso)', async () => {
    bd({ asignaciones: [
      asig({ id: 1, estado: 'activa', inicio_real_at: null, finalizado_at: null,
             fecha_inicio: d('2026-09-27T09:00:00Z') }),          // 1 h antes de AHORA
      asig({ id: 2, estado: 'programada', inicio_real_at: null, finalizado_at: null,
             fecha_inicio: d('2026-09-27T09:45:00Z') }),          // aún dentro del margen
    ] });
    const r = await inf.calcularInforme('2026-09', AHORA);
    expect(r.resumen.sin_iniciar).toBe(1);
    expect(r.resumen.finalizados).toBe(0);
  });

  it('llegada, desplazamiento, cierres fuera de hora, horas, km y fotos tarde', async () => {
    bd({ asignaciones: [
      asig({ id: 1, llegada_servicio_at: d('2026-09-10T06:25:00Z'),
             finalizado_at: d('2026-09-10T15:00:00Z'), fotos_inicio_tarde: 2 }),
      asig({ id: 2, finalizado_at: d('2026-09-10T12:00:00Z'), km_fin: 900 }),   // km que bajan: no suman
    ] });
    const r = await inf.calcularInforme('2026-09', AHORA);
    expect(r.resumen).toMatchObject({
      con_llegada: 1, desplazamiento_mediana_min: 20,
      cierres_tardios: 1, cierres_anticipados: 1,
      con_fotos_inicio_tarde: 1, km_recorridos: 120,
      horas_servicio: 14.8,     // 8h55 + 5h55
    });
  });

  it('por técnico: el retraso es del responsable; el personal solo suma «como personal»', async () => {
    bd({
      asignaciones: [asig({ id: 1, inicio_real_at: d('2026-09-10T07:00:00Z') })],
      miembros: [
        { asignacion_id: 1, user_id: 7, rol: 'responsable', nombre: 'Ana', apellidos: 'Ruiz' },
        { asignacion_id: 1, user_id: 8, rol: 'personal', nombre: 'Luis', apellidos: 'Gil' },
        { asignacion_id: 99, user_id: 9, rol: 'responsable', nombre: 'X', apellidos: '' },
      ],
    });
    const r = await inf.calcularInforme('2026-09', AHORA);
    const ana  = r.por_tecnico.find(t => t.user_id === 7);
    const luis = r.por_tecnico.find(t => t.user_id === 8);
    expect(ana).toMatchObject({ nombre: 'Ana Ruiz', servicios: 1, inicios_tardios: 1, como_personal: 0 });
    expect(luis).toMatchObject({ servicios: 0, inicios_tardios: 0, como_personal: 1 });
    expect(r.por_tecnico.some(t => t.user_id === 9)).toBe(false);
  });

  it('incidencias: nuevas por gravedad, resueltas, abiertas al cierre y reparto', async () => {
    bd({
      asignaciones: [asig()],
      miembros: [{ asignacion_id: 1, user_id: 7, rol: 'responsable', nombre: 'Ana', apellidos: 'Ruiz' }],
      flota: [
        { id: 10, alias: 'Ambulancia 10', matricula: '1010AAA' },
        { id: 11, alias: 'Ambulancia 11', matricula: '1111AAA' },
        { id: 12, alias: 'Ambulancia 12', matricula: '1212AAA' },
      ],
      incidencias: [
        { id: 1, vehicle_id: 10, gravedad: 'grave', estado: 'pendiente',
          created_at: d('2026-09-11T08:00:00Z'), resuelto_at: null, responsable_user_id: 7 },
        { id: 2, vehicle_id: 11, gravedad: 'leve', estado: 'resuelto',
          created_at: d('2026-09-12T08:00:00Z'), resuelto_at: d('2026-09-12T20:00:00Z') },
        // de agosto, resuelta en octubre: abierta al cerrar septiembre
        { id: 3, vehicle_id: 10, gravedad: 'moderado', estado: 'resuelto',
          created_at: d('2026-08-20T08:00:00Z'), resuelto_at: d('2026-10-02T08:00:00Z') },
        // «resuelto» sin fecha (antiguo): no cuenta como abierta
        { id: 4, vehicle_id: 10, gravedad: 'leve', estado: 'resuelto',
          created_at: d('2026-08-01T08:00:00Z'), resuelto_at: null },
      ],
    });
    const r = await inf.calcularInforme('2026-09', AHORA);
    expect(r.resumen.incidencias).toEqual({
      nuevas: 2, graves: 1, moderadas: 0, leves: 1, resueltas: 1, abiertas_fin: 2,
      resolucion_mediana_horas: 12,
    });
    expect(r.por_vehiculo.find(v => v.vehicle_id === 10).incidencias).toBe(1);
    // un vehículo sin servicios pero con incidencia entra en la tabla
    expect(r.por_vehiculo.find(v => v.vehicle_id === 11)).toMatchObject({ servicios: 0, incidencias: 1 });
    expect(r.vehiculos_sin_uso.map(v => v.vehicle_id)).toEqual([11, 12]);
    expect(r.por_tecnico[0].incidencias).toBe(1);
    expect(r.resumen).toMatchObject({ vehiculos_en_flota: 3, vehiculos_usados: 1 });
  });

  it('un mes vacío no rompe: medianas a null', async () => {
    bd();
    const r = await inf.calcularInforme('2026-09', AHORA);
    expect(r.resumen).toMatchObject({ servicios: 0, retraso_mediana_min: null, desplazamiento_mediana_min: null });
    expect(r.resumen.incidencias.resolucion_mediana_horas).toBeNull();
  });
});

describe('informes.service · obtenerInforme y archivarMeses', () => {
  it('un mes futuro da null sin consultar', async () => {
    bd();
    expect(await inf.obtenerInforme('2026-10', AHORA)).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('el archivado manda sobre el cálculo en vivo', async () => {
    bd({ archivados: { '2025-09': JSON.stringify({ mes: '2025-09', resumen: { servicios: 40 } }) } });
    const r = await inf.obtenerInforme('2025-09', AHORA);
    expect(r).toMatchObject({ fuente: 'archivado', resumen: { servicios: 40 } });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('sin archivo se calcula en vivo y marca el mes en curso', async () => {
    bd();
    const r = await inf.obtenerInforme('2026-09', AHORA);
    expect(r).toMatchObject({ fuente: 'en_vivo', en_curso: true, version: inf.VERSION_INFORME });
    const pasado = await inf.obtenerInforme('2026-08', AHORA);
    expect(pasado.en_curso).toBe(false);
  });

  it('archivarMeses: solo meses cerrados, sin repetir los ya archivados', async () => {
    bd({ archivados: { '2025-11': '{}' } });
    const nuevos = await inf.archivarMeses([
      d('2025-11-03T07:00:00Z'), d('2025-11-20T07:00:00Z'),
      d('2025-12-31T23:30:00Z'),          // ya es enero en España
      d('2026-09-20T07:00:00Z'),          // mes en curso: no
    ], AHORA);

    expect(nuevos).toEqual(['2026-01']);
    const insert = query.mock.calls.find(([sql]) => sql.startsWith('INSERT IGNORE INTO informe_mensual'));
    expect(insert[1][0]).toBe('2026-01');
    expect(insert[1][1]).toBe(inf.VERSION_INFORME);
    expect(JSON.parse(insert[1][2])).toMatchObject({ mes: '2026-01' });
  });

  it('archivarMeses sin meses cerrados no toca la BD', async () => {
    bd();
    expect(await inf.archivarMeses([d('2026-09-20T07:00:00Z')], AHORA)).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('archivarMeses lanza si falla el guardado (la retención no debe purgar)', async () => {
    bd();
    query.mockImplementationOnce(async () => [[]]);        // SELECT mes
    query.mockImplementation(async () => { throw new Error('disco lleno'); });
    await expect(inf.archivarMeses([d('2025-11-03T07:00:00Z')], AHORA)).rejects.toThrow('disco lleno');
  });
});
