'use strict';

/**
 * «Inicio de jornada» / «Fin de jornada» (v39): los botones de fichar de una
 * ambulancia con horario por días, y lo que cambian en la llegada, el fin del
 * evento y el cierre. Reglas en §6.1 «Jornadas por día» del mapa.
 */

const { query, transaction } = require('../../../config/database');

jest.mock('../../../controllers/admin.controller', () => ({ logAudit: jest.fn() }));
jest.mock('../../../services/avisosAsignacion.service', () => ({
  avisarInicioJornada: jest.fn(),
  avisarFinJornada:    jest.fn(),
  avisarLlegadaEvento: jest.fn(),
  avisarFinEvento:     jest.fn(),
}));

const {
  iniciarJornada, finalizarJornada, registrarLlegada, registrarFinServicio, finalizarAsignacion,
} = require('../../../controllers/asignaciones.controller');
const avisos = require('../../../services/avisosAsignacion.service');
const { logAudit } = require('../../../controllers/admin.controller');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');
const { IMAGEN_TIPOS_INICIO } = require('../../../config/constants');

const ADMIN  = { id: 1, username: 'admin', roles: ['administrador'], permissions: ['manage_trabajos'] };
const TEC    = { id: 2, username: 'tec', roles: ['tecnico'], permissions: [] };
const EQUIPO = { id: 3, username: 'eva', roles: ['tecnico'], permissions: [] };

const MIN = 60000;
const H = 60 * MIN;
const ahora = () => Date.now();
const FOTOS_INICIO = IMAGEN_TIPOS_INICIO.map(t => ({ tipo_imagen: t, momento: 'inicio' }));

function fila(over = {}) {
  return {
    id: 10, trabajo_id: 40, vehicle_id: 7, user_id: 2, estado: 'activa',
    fecha_inicio: new Date(ahora() - 2 * H), fecha_fin: new Date(ahora() + 48 * H),
    inicio_real_at: new Date(ahora() - 2 * H), matricula: '7777AAA',
    trabajo_nombre: 'Congreso', trabajo_coordinador_id: 5,
    ...over,
  };
}

/** Una jornada, con su hora prevista relativa a ahora. */
function jornada(id, desdeH, hastaH, over = {}) {
  return { id, inicio: new Date(ahora() + desdeH * H), fin: new Date(ahora() + hastaH * H),
           inicio_real_at: null, fin_real_at: null, cierre_auto: 0, ...over };
}

function bd({ asig = fila(), jornadas = [], fotos = FOTOS_INICIO, updates = {} } = {}) {
  query.mockImplementation(async (sql, params) => {
    if (sql.includes('trabajo_coordinador_apellidos')) return [[asig]];
    if (sql.includes('FROM asignacion_jornadas j')) return [jornadas];
    if (sql.includes('SELECT au.user_id, au.rol')) {
      return [[{ user_id: 2, rol: 'responsable', orden: 0, username: 'tec' },
               { user_id: 3, rol: 'personal', orden: 0, username: 'eva' }]];
    }
    if (sql.includes('created_at AS uploaded_at')) return [fotos];
    if (sql.includes('SELECT tipo_imagen, momento FROM vehicle_images')) return [fotos];
    for (const [frag, r] of Object.entries(updates)) if (sql.includes(frag)) return [r];
    if (/^\s*(UPDATE|INSERT|DELETE)/.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
}
const llamadas = (frag) => query.mock.calls.filter(([sql]) => sql.includes(frag));

async function pulsar(fn, { user = TEC, jornadaId = 100, body = {} } = {}) {
  const res = mockRes();
  await fn(mockReq({ params: { id: '10', jornadaId: String(jornadaId) }, body, user }), res, mockNext());
  return res;
}

describe('fichaje de jornadas (v39)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    query.mockReset();
    transaction.mockReset();
    transaction.mockImplementation(async (cb) => cb({ execute: (sql, p) => query(sql, p) }));
  });

  describe('Inicio de jornada', () => {
    it('sella la hora, audita y avisa a gestión', async () => {
      bd({ jornadas: [jornada(100, 0.25, 8)] });
      const res = await pulsar(iniciarJornada);

      expect(res.status).toHaveBeenCalledWith(200);
      const [sql, params] = llamadas('SET inicio_real_at = ?, inicio_por = ?')[0];
      expect(sql).toContain('inicio_real_at IS NULL');
      expect(params.slice(1)).toEqual([2, 100, 10]);
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'start_jornada', details: expect.objectContaining({ jornada_id: 100 }) }));
      expect(avisos.avisarInicioJornada).toHaveBeenCalledWith(
        expect.objectContaining({ id: 10 }), expect.objectContaining({ id: 100 }));
    });

    it('ya iniciada: 200 sin tocar nada, aunque la asignación esté cerrada', async () => {
      bd({ asig: fila({ estado: 'finalizada' }),
           jornadas: [jornada(100, -1, 8, { inicio_real_at: new Date() })] });
      const res = await pulsar(iniciarJornada);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(llamadas('UPDATE asignacion_jornadas')).toHaveLength(0);
      expect(logAudit).not.toHaveBeenCalled();
    });

    it('la pulsación que llega tarde a la carrera no audita ni avisa', async () => {
      bd({ jornadas: [jornada(100, 0, 8)], updates: { 'SET inicio_real_at = ?': { affectedRows: 0 } } });
      const res = await pulsar(iniciarJornada);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(logAudit).not.toHaveBeenCalled();
      expect(avisos.avisarInicioJornada).not.toHaveBeenCalled();
    });

    it('una anterior olvidada abierta se cierra sola a su hora prevista, marcada', async () => {
      bd({ jornadas: [
        jornada(99, -20, -10, { inicio_real_at: new Date(ahora() - 20 * H) }),
        jornada(100, 0, 8),
      ] });
      const res = await pulsar(iniciarJornada);
      expect(res.status).toHaveBeenCalledWith(200);
      const [sql, params] = llamadas('cierre_auto = 1')[0];
      expect(sql).toContain('SET fin_real_at = fin, cierre_auto = 1');
      expect(params).toEqual([99]);
      expect(logAudit.mock.calls[0][0].details.cerradas_solas).toEqual([99]);
    });

    it('si otra pulsación selló antes, no cierra las olvidadas ni audita', async () => {
      bd({ jornadas: [
        jornada(99, -20, -10, { inicio_real_at: new Date(ahora() - 20 * H) }),
        jornada(100, 0, 8),
      ], updates: { 'SET inicio_real_at = ?': { affectedRows: 0 } } });
      const res = await pulsar(iniciarJornada);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(logAudit).not.toHaveBeenCalled();
    });

    it.each([
      ['el equipo no ficha', { user: EQUIPO }, {}, 403],
      ['jornada de otra asignación', { jornadaId: 555 }, {}, 404],
      ['asignación cancelada', {}, { asig: fila({ estado: 'cancelada' }) }, 400],
      ['sin «Inicio de la asignación»', {}, { asig: fila({ inicio_real_at: null }) }, 400],
      ['sin las fotos de inicio', {}, { fotos: [] }, 400],
    ])('rechaza: %s', async (_, opciones, datos, status) => {
      bd({ jornadas: [jornada(100, 0, 8)], ...datos });
      const res = await pulsar(iniciarJornada, opciones);
      expect(res.status).toHaveBeenCalledWith(status);
      expect(llamadas('UPDATE asignacion_jornadas')).toHaveLength(0);
    });

    it('no antes de media hora de la prevista, y dice desde cuándo', async () => {
      bd({ jornadas: [jornada(100, 1, 8)] });
      const res = await pulsar(iniciarJornada);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('se puede iniciar desde el');
    });

    it('no una que ya ha terminado', async () => {
      bd({ jornadas: [jornada(100, -10, -1)] });
      const res = await pulsar(iniciarJornada);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('ya ha terminado');
    });

    it('no una anterior a otra ya iniciada', async () => {
      bd({ jornadas: [jornada(100, -1, 8), jornada(101, 0.2, 9, { inicio_real_at: new Date() })] });
      const res = await pulsar(iniciarJornada);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('gestión puede fichar por el responsable', async () => {
      bd({ jornadas: [jornada(100, 0, 8)] });
      const res = await pulsar(iniciarJornada, { user: ADMIN });
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('Fin de jornada', () => {
    const empezada = (desdeH, hastaH, over = {}) =>
      jornada(100, desdeH, hastaH, { inicio_real_at: new Date(ahora() + desdeH * H), ...over });

    it('a su hora: sella sin motivo, audita y avisa', async () => {
      bd({ jornadas: [empezada(-8, 0.25)] });
      const res = await pulsar(finalizarJornada);
      expect(res.status).toHaveBeenCalledWith(200);
      const [, params] = llamadas('SET fin_real_at = ?, fin_por = ?')[0];
      expect(params.slice(1)).toEqual([2, null, 100, 10]);
      expect(logAudit.mock.calls[0][0].details.anticipado).toBe(false);
      expect(avisos.avisarFinJornada).toHaveBeenCalled();
    });

    it('más de 30 min antes pide el motivo (400 con el campo) y lo guarda', async () => {
      bd({ jornadas: [empezada(-2, 3)] });
      const sin = await pulsar(finalizarJornada);
      expect(sin.status).toHaveBeenCalledWith(400);
      expect(sin._json.errors).toEqual([expect.objectContaining({ field: 'motivo_fin' })]);

      const corto = await pulsar(finalizarJornada, { body: { motivo_fin: 'aaaaa' } });
      expect(corto.status).toHaveBeenCalledWith(400);

      const con = await pulsar(finalizarJornada, { body: { motivo_fin: 'Se suspende la sesión de tarde' } });
      expect(con.status).toHaveBeenCalledWith(200);
      expect(llamadas('SET fin_real_at = ?, fin_por = ?')[0][1][2]).toBe('Se suspende la sesión de tarde');
    });

    it('a menos de 30 min del fin no pide motivo', async () => {
      bd({ jornadas: [empezada(-8, 0.4)] });
      expect((await pulsar(finalizarJornada)).status).toHaveBeenCalledWith(200);
    });

    it('ya terminada: 200 sin tocar nada', async () => {
      bd({ jornadas: [empezada(-8, -1, { fin_real_at: new Date() })] });
      const res = await pulsar(finalizarJornada);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(llamadas('UPDATE asignacion_jornadas')).toHaveLength(0);
    });

    it('sin iniciar, o con la asignación cerrada: 400', async () => {
      bd({ jornadas: [jornada(100, -1, 8)] });
      expect((await pulsar(finalizarJornada)).status).toHaveBeenCalledWith(400);

      bd({ asig: fila({ estado: 'finalizada' }), jornadas: [empezada(-8, 0)] });
      expect((await pulsar(finalizarJornada)).status).toHaveBeenCalledWith(400);
    });
  });

  describe('con jornadas, la asignación', () => {
    const req = (body = {}) => mockReq({ params: { id: '10' }, body, user: TEC });

    it('no admite «Inicio evento/servicio» ni «Fin evento/servicio»', async () => {
      bd({ jornadas: [jornada(100, 0, 8)] });
      const res = mockRes();
      await registrarLlegada(req(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('ficha por jornadas');

      const res2 = mockRes();
      await registrarFinServicio(req(), res2, mockNext());
      expect(res2.status).toHaveBeenCalledWith(400);
    });

    it('no se finaliza con una jornada abierta', async () => {
      bd({ jornadas: [jornada(100, -2, 8, { inicio_real_at: new Date() })] });
      const res = mockRes();
      await finalizarAsignacion(req({ km_fin: 1000, material_usado: 'Nada' }), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res._json.message).toContain('Fin de jornada');
    });
  });
});
