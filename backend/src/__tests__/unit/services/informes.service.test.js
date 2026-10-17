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
    finalizado_at: d('2026-09-10T14:00:00Z'),
    fotos_inicio_tarde: 0, ...extra,
  };
}

/** BD falsa: responde según la consulta. */
function bd({ asignaciones = [], miembros = [], flota = [], incidencias = [], archivados = {}, jornadas = [] } = {}) {
  query.mockReset();
  query.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM asignacion_jornadas')) return [jornadas.filter(j => params.includes(j.asignacion_id))];
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

  it('llegada, desplazamiento, cierres fuera de hora, horas y fotos tarde', async () => {
    bd({ asignaciones: [
      asig({ id: 1, llegada_servicio_at: d('2026-09-10T06:25:00Z'),
             finalizado_at: d('2026-09-10T15:00:00Z'), fotos_inicio_tarde: 2 }),
      asig({ id: 2, finalizado_at: d('2026-09-10T12:00:00Z') }),
    ] });
    const r = await inf.calcularInforme('2026-09', AHORA);
    expect(r.resumen).toMatchObject({
      con_llegada: 1, desplazamiento_mediana_min: 20,
      cierres_tardios: 1, cierres_anticipados: 1,
      con_fotos_inicio_tarde: 1,
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

  it('por técnico: tiempo de asignación y en el evento, responsable y personal por igual', async () => {
    bd({
      asignaciones: [
        // 06:05 → 14:00 de asignación (7h55); 06:30 → 12:00 en el evento (5h30)
        asig({ id: 1, llegada_servicio_at: d('2026-09-10T06:30:00Z'), fin_servicio_at: d('2026-09-10T12:00:00Z') }),
        // finalizada sin fin del evento: suma a la asignación (4h), no al evento
        asig({ id: 2, inicio_real_at: d('2026-09-11T06:00:00Z'), finalizado_at: d('2026-09-11T10:00:00Z'),
               llegada_servicio_at: d('2026-09-11T06:20:00Z'), fin_servicio_at: null }),
        // aún activa con el evento cerrado: suma al evento (1h), no a la asignación
        asig({ id: 3, estado: 'activa', finalizado_at: null,
               llegada_servicio_at: d('2026-09-12T07:00:00Z'), fin_servicio_at: d('2026-09-12T08:00:00Z') }),
      ],
      miembros: [
        { asignacion_id: 1, user_id: 7, rol: 'responsable', nombre: 'Ana', apellidos: 'Ruiz' },
        { asignacion_id: 2, user_id: 7, rol: 'responsable', nombre: 'Ana', apellidos: 'Ruiz' },
        { asignacion_id: 3, user_id: 7, rol: 'responsable', nombre: 'Ana', apellidos: 'Ruiz' },
        { asignacion_id: 1, user_id: 8, rol: 'personal', nombre: 'Luis', apellidos: 'Gil' },
      ],
    });
    const r = await inf.calcularInforme('2026-09', AHORA);
    expect(r.por_tecnico.find(t => t.user_id === 7)).toMatchObject({
      minutos_asignacion: 715, asignaciones_medidas: 2, asignaciones_sin_finalizar: 1,   // 7h55 + 4h; la 3 sigue activa
      minutos_en_evento: 390, eventos_medidos: 2, eventos_sin_fin: 1,   // 5h30 + 1h
    });
    expect(r.por_tecnico.find(t => t.user_id === 8)).toMatchObject({
      minutos_asignacion: 475, asignaciones_medidas: 1, asignaciones_sin_finalizar: 0,
      minutos_en_evento: 330, eventos_medidos: 1, eventos_sin_fin: 0,
    });
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

describe('informes.service · detalleTecnico', () => {
  const OCT = new Date('2026-10-11T10:00:00.000Z');
  /** Asignación de octubre (después de los dos cortes de botones). */
  const oct = (extra = {}) => asig({
    fecha_inicio: d('2026-10-05T06:00:00Z'), fecha_fin: d('2026-10-05T14:00:00Z'),
    inicio_real_at: d('2026-10-05T06:05:00Z'),
    llegada_servicio_at: d('2026-10-05T06:30:00Z'), fin_servicio_at: d('2026-10-05T13:00:00Z'),
    finalizado_at: d('2026-10-05T14:00:00Z'), rol: 'responsable', revisar_fin_evento: null,
    trabajo_id: null, ...extra,
  });
  function bdDetalle({ usuario = { id: 7, nombre: 'Ana', apellidos: 'Ruiz' }, filas = [], archivado = false } = {}) {
    query.mockReset();
    query.mockImplementation(async (sql) => {
      if (sql.includes('FROM users')) return [usuario ? [usuario] : []];
      if (sql.includes('FROM asignacion_usuarios au')) return [filas];
      if (sql.includes('FROM informe_mensual')) return [archivado ? [{ hay: 1 }] : []];
      return [[]];
    });
  }
  const codigos = (s) => s.avisos.map(a => a.codigo);

  it('usuario que no existe → null', async () => {
    bdDetalle({ usuario: null });
    expect(await inf.detalleTecnico('2026-10', 99, 1, OCT)).toBeNull();
  });

  it('filtra por técnico y mes, y la marca «A revisar» se pide con el id de quien mira', async () => {
    bdDetalle();
    await inf.detalleTecnico('2026-10', 7, 1, OCT);
    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain('au.user_id = ?');
    expect(sql).toContain("al.estado <> 'cancelada'");
    expect(params.slice(0, 3)).toEqual([1, 1, 1]);          // paramsRevisarFinEvento(viewer)
    expect(params[6]).toBe(7);   // tras los 6 de paramsRevisarFinEvento (v39)
    expect(params[7].toISOString()).toBe('2026-09-30T22:00:00.000Z');
  });

  it('servicio limpio: horas de asignación y de evento, sin avisos', async () => {
    bdDetalle({ filas: [oct()] });
    const r = await inf.detalleTecnico('2026-10', 7, 1, OCT);
    expect(r).toMatchObject({ nombre: 'Ana Ruiz', en_curso: true, archivado: false, umbral_min: 30 });
    expect(r.servicios[0]).toMatchObject({ minutos_asignacion: 475, minutos_en_evento: 390, avisos: [] });
  });

  it('marca lo que deja las horas fuera o infladas', async () => {
    bdDetalle({ filas: [
      oct({ id: 1, inicio_real_at: null, estado: 'activa', finalizado_at: null,
            llegada_servicio_at: null, fin_servicio_at: null }),
      oct({ id: 2, estado: 'activa', finalizado_at: null }),
      oct({ id: 3, llegada_servicio_at: null, fin_servicio_at: null }),
      oct({ id: 4, fin_servicio_at: null }),
      oct({ id: 5, fin_servicio_at: d('2026-10-05T13:50:00Z'), revisar_fin_evento: 'pegado' }),
    ] });
    const { servicios: s } = await inf.detalleTecnico('2026-10', 7, 1, OCT);
    expect(codigos(s[0])).toEqual(['sin_iniciar']);
    expect(codigos(s[1])).toEqual(['sin_finalizar']);
    expect(s[1].minutos_asignacion).toBeNull();
    expect(codigos(s[2])).toEqual(['sin_inicio_evento']);
    expect(codigos(s[3])).toEqual(['evento_sin_fin']);
    expect(s[4].avisos).toEqual([{ codigo: 'fin_evento_pegado', nivel: 'grave', minutos: 10 }]);
  });

  it('lo que está en curso no se marca como sin finalizar', async () => {
    bdDetalle({ filas: [oct({ estado: 'activa', fecha_inicio: d('2026-10-11T06:00:00Z'),
                              fecha_fin: d('2026-10-11T14:00:00Z'), inicio_real_at: d('2026-10-11T06:00:00Z'),
                              llegada_servicio_at: null, fin_servicio_at: null, finalizado_at: null })] });
    const { servicios } = await inf.detalleTecnico('2026-10', 7, 1, OCT);
    expect(servicios[0].avisos).toEqual([]);
  });

  it('antes de que existieran los botones de evento no se echan de menos', async () => {
    bdDetalle({ filas: [
      asig({ id: 1, rol: 'personal' }),                                     // 10-sep, sin llegada
      asig({ id: 2, fecha_inicio: d('2026-09-28T06:00:00Z'), fecha_fin: d('2026-09-28T14:00:00Z'),
             inicio_real_at: d('2026-09-28T06:00:00Z'), finalizado_at: d('2026-09-28T14:00:00Z'),
             llegada_servicio_at: d('2026-09-28T07:00:00Z') }),           // con llegada y sin fin
    ] });
    const { servicios } = await inf.detalleTecnico('2026-09', 7, 1, OCT);
    expect(servicios.map(codigos)).toEqual([[], []]);
  });

  it('avisos leves: inicio tardío y cierre fuera de hora, con los minutos', async () => {
    bdDetalle({ filas: [oct({ inicio_real_at: d('2026-10-05T07:00:00Z'), finalizado_at: d('2026-10-05T15:00:00Z') })] });
    const { servicios } = await inf.detalleTecnico('2026-10', 7, 1, OCT);
    expect(servicios[0].avisos).toEqual([
      { codigo: 'inicio_tardio', nivel: 'aviso', minutos: 60 },
      { codigo: 'cierre_tardio', nivel: 'aviso', minutos: 60 },
    ]);
  });

  it('al Equipo no se le cargan el inicio tardío ni el cierre: los pulsa el responsable', async () => {
    bdDetalle({ filas: [oct({ rol: 'personal', inicio_real_at: d('2026-10-05T07:00:00Z'),
                              finalizado_at: d('2026-10-05T15:00:00Z') })] });
    const { servicios } = await inf.detalleTecnico('2026-10', 7, 1, OCT);
    expect(servicios[0].avisos).toEqual([]);
    expect(servicios[0].minutos_asignacion).toBe(480);   // sus horas sí cuentan
  });

  it('avisa si el mes está archivado (el detalle es en vivo)', async () => {
    bdDetalle({ archivado: true });
    expect((await inf.detalleTecnico('2026-08', 7, 1, OCT)).archivado).toBe(true);
  });
});

describe('informes.service · jornadas por día (v39)', () => {
  // Un congreso de tres días: la asignación va de 06:00 del 10 a 20:00 del 12
  // (62 h con las noches); las jornadas, 10 h cada día
  const congreso = (extra = {}) => asig({
    id: 1, fecha_inicio: d('2026-09-10T06:00:00Z'), fecha_fin: d('2026-09-12T20:00:00Z'),
    inicio_real_at: d('2026-09-10T06:00:00Z'), finalizado_at: d('2026-09-12T20:00:00Z'), ...extra,
  });
  const jornada = (dia, extra = {}) => ({
    asignacion_id: 1, inicio: d(`2026-09-${dia}T08:00:00Z`), fin: d(`2026-09-${dia}T18:00:00Z`),
    inicio_real_at: d(`2026-09-${dia}T08:00:00Z`), fin_real_at: d(`2026-09-${dia}T18:00:00Z`),
    cierre_auto: 0, motivo_fin: null, ...extra,
  });
  const ANA = [{ asignacion_id: 1, user_id: 7, rol: 'responsable', nombre: 'Ana', apellidos: 'Ruiz' }];

  it('las horas de asignación y de evento son la suma de jornadas, no las 62 h del total', async () => {
    bd({ asignaciones: [congreso()], miembros: ANA,
         jornadas: [jornada('10'), jornada('11'), jornada('12')] });
    const r = await inf.calcularInforme('2026-09', AHORA);
    expect(r.por_tecnico[0]).toMatchObject({
      minutos_asignacion: 1800, asignaciones_medidas: 1, minutos_en_evento: 1800, eventos_medidos: 1,
    });
    expect(r.version).toBe(3);
  });

  it('la jornada que se cerró sola no suma; la que nadie inició, tampoco', async () => {
    bd({ asignaciones: [congreso()], miembros: ANA, jornadas: [
      jornada('10'),
      jornada('11', { cierre_auto: 1 }),
      jornada('12', { inicio_real_at: null, fin_real_at: null }),
    ] });
    const r = await inf.calcularInforme('2026-09', AHORA);
    expect(r.por_tecnico[0]).toMatchObject({ minutos_asignacion: 600, minutos_en_evento: 600 });
  });

  it('finalizada sin ninguna jornada medida: no cuenta como medida con 0 h', async () => {
    bd({ asignaciones: [congreso()], miembros: ANA,
         jornadas: [jornada('10', { cierre_auto: 1 }), jornada('11', { inicio_real_at: null, fin_real_at: null })] });
    const r = await inf.calcularInforme('2026-09', AHORA);
    expect(r.por_tecnico[0]).toMatchObject({ minutos_asignacion: 0, asignaciones_medidas: 0 });
  });

  it('sin finalizar la asignación, las de asignación no suman y las de evento sí (lo abierto no cuenta)', async () => {
    bd({ asignaciones: [congreso({ estado: 'activa', finalizado_at: null })], miembros: ANA,
         jornadas: [jornada('10')] });
    const r = await inf.calcularInforme('2026-09', AHORA);
    expect(r.por_tecnico[0]).toMatchObject({
      minutos_asignacion: 0, asignaciones_sin_finalizar: 1, minutos_en_evento: 600,
    });
  });

  describe('avisos del detalle del técnico', () => {
    const OCT = new Date('2026-10-20T10:00:00.000Z');
    const fila = (extra = {}) => ({
      id: 1, trabajo_id: 5, estado: 'finalizada', rol: 'responsable', revisar_fin_evento: null,
      alias: 'Ambulancia 10', matricula: '1010AAA', trabajo_nombre: 'Congreso',
      fecha_inicio: d('2026-10-05T06:00:00Z'), fecha_fin: d('2026-10-07T20:00:00Z'),
      inicio_real_at: d('2026-10-05T06:00:00Z'), llegada_servicio_at: null, fin_servicio_at: null,
      finalizado_at: d('2026-10-07T20:00:00Z'), ...extra,
    });
    const jor = (dia, extra = {}) => jornada(dia, {
      inicio: d(`2026-10-${dia}T08:00:00Z`), fin: d(`2026-10-${dia}T18:00:00Z`),
      inicio_real_at: d(`2026-10-${dia}T08:00:00Z`), fin_real_at: d(`2026-10-${dia}T18:00:00Z`), ...extra,
    });
    function bdJornadas(jornadas, extra) {
      query.mockReset();
      query.mockImplementation(async (sql) => {
        if (sql.includes('FROM users')) return [[{ id: 7, nombre: 'Ana', apellidos: 'Ruiz' }]];
        // Antes que las jornadas: la fila lleva SQL_REVISAR_FIN_EVENTO, que las nombra
        if (sql.includes('FROM asignacion_usuarios au')) return [[fila(extra)]];
        if (sql.includes('FROM asignacion_jornadas')) return [jornadas];
        return [[]];
      });
    }

    it('sin llegada ni fin del evento no marca nada del evento: la jornada lo sustituye', async () => {
      bdJornadas([jor('05'), jor('06'), jor('07')]);
      const r = await inf.detalleTecnico('2026-10', 7, 1, OCT);
      expect(r.servicios[0].avisos).toEqual([]);
      expect(r.servicios[0].minutos_asignacion).toBe(1800);
      expect(r.servicios[0].jornadas).toHaveLength(3);
      expect(r.servicios[0].jornadas[0]).toMatchObject({ cierre_auto: false, motivo_fin: null });
    });

    it('marca la que nadie inició, la que se cerró sola y el fin anticipado', async () => {
      bdJornadas([
        jor('05', { inicio_real_at: null, fin_real_at: null }),
        jor('06', { cierre_auto: 1 }),
        jor('07', { motivo_fin: 'Se suspende la sesión' }),
      ]);
      const r = await inf.detalleTecnico('2026-10', 7, 1, OCT);
      expect(r.servicios[0].avisos).toEqual([
        { codigo: 'jornada_sin_iniciar', nivel: 'grave', cuantas: 1 },
        { codigo: 'jornada_cerrada_sola', nivel: 'grave', cuantas: 1 },
        { codigo: 'fin_jornada_anticipado', nivel: 'aviso', cuantas: 1 },
      ]);
    });

    it('el último «Fin de jornada» pegado al cierre sale como grave, con sus minutos', async () => {
      bdJornadas([jor('07', { fin_real_at: d('2026-10-07T19:50:00Z') })], { revisar_fin_evento: 'pegado' });
      const r = await inf.detalleTecnico('2026-10', 7, 1, OCT);
      expect(r.servicios[0].avisos).toContainEqual({ codigo: 'fin_jornada_pegado', nivel: 'grave', minutos: 10 });
    });

    it('una jornada abierta en una asignación que ya debió cerrar es grave; al equipo no se le carga el anticipado', async () => {
      bdJornadas([jor('05', { fin_real_at: null, motivo_fin: 'x' })],
        { estado: 'activa', finalizado_at: null, rol: 'personal' });
      const r = await inf.detalleTecnico('2026-10', 7, 1, OCT);
      const codigos = r.servicios[0].avisos.map(a => a.codigo);
      expect(codigos).toContain('jornada_sin_fin');
      expect(codigos).not.toContain('fin_jornada_anticipado');
    });
  });
});
