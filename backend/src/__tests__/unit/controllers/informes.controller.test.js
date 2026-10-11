'use strict';

jest.mock('../../../services/informes.service', () => {
  const real = jest.requireActual('../../../services/informes.service');
  return { ...real, obtenerInforme: jest.fn(), detalleTecnico: jest.fn() };
});
jest.mock('../../../utils/fecha.utils', () => ({
  ...jest.requireActual('../../../utils/fecha.utils'),
  ahora: () => new Date('2026-09-27T10:00:00.000Z'),
}));

jest.mock('../../../controllers/admin.controller', () => ({ logError: jest.fn() }));

const informes = require('../../../services/informes.service');
const { logError } = require('../../../controllers/admin.controller');
const { getInformeMensual, getDetalleTecnico } = require('../../../controllers/informes.controller');
const { mockReq, mockRes } = require('../../helpers/mockReqRes');

describe('informes.controller · getInformeMensual', () => {
  beforeEach(() => {
    informes.obtenerInforme.mockReset();
    informes.obtenerInforme.mockImplementation(async (mes) => ({
      mes, fuente: 'en_vivo', en_curso: mes === '2026-09', resumen: { servicios: 1 },
      por_tecnico: [{ user_id: 7 }],
    }));
  });

  it('sin mes, el en curso; compara con el anterior y el del año pasado (solo resumen)', async () => {
    const res = mockRes();
    await getInformeMensual(mockReq({ query: {} }), res);

    expect(informes.obtenerInforme.mock.calls.map(c => c[0])).toEqual(['2026-09', '2026-08', '2025-09']);
    const { data } = res.json.mock.calls[0][0];
    expect(data.actual.por_tecnico).toHaveLength(1);
    expect(data.comparativa.anterior).toEqual({
      mes: '2026-08', fuente: 'en_vivo', en_curso: false, resumen: { servicios: 1 },
    });
    expect(data.comparativa.anio_anterior.mes).toBe('2025-09');
  });

  it('comparativa sin datos → null', async () => {
    informes.obtenerInforme.mockImplementation(async (mes) => (mes === '2026-03' ? { mes, resumen: {} } : null));
    const res = mockRes();
    await getInformeMensual(mockReq({ query: { mes: '2026-03' } }), res);
    expect(res.json.mock.calls[0][0].data.comparativa).toEqual({ anterior: null, anio_anterior: null });
  });

  it('400 con un mes mal escrito o futuro', async () => {
    for (const mes of ['2026-9', 'hola', '2026-10']) {
      const res = mockRes();
      await getInformeMensual(mockReq({ query: { mes } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    expect(informes.obtenerInforme).not.toHaveBeenCalled();
  });

  it('500 si falla el cálculo', async () => {
    informes.obtenerInforme.mockRejectedValue(new Error('BD caída'));
    const res = mockRes();
    await getInformeMensual(mockReq({ query: { mes: '2026-08' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    // Contesta él mismo en vez de next(err): sin esto no llegaba al panel.
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500, errorMessage: 'BD caída' }));
  });
});

describe('informes.controller · getDetalleTecnico', () => {
  beforeEach(() => {
    informes.detalleTecnico.mockReset();
    informes.detalleTecnico.mockResolvedValue({ mes: '2026-09', user_id: 7, servicios: [] });
  });

  it('pasa mes, técnico y quien mira', async () => {
    const res = mockRes();
    await getDetalleTecnico(mockReq({ params: { userId: '7' }, query: { mes: '2026-08' }, user: { id: 1 } }), res);
    expect(informes.detalleTecnico).toHaveBeenCalledWith('2026-08', 7, 1, expect.any(Date));
    expect(res.json.mock.calls[0][0].data.user_id).toBe(7);
  });

  it('sin mes, el en curso', async () => {
    await getDetalleTecnico(mockReq({ params: { userId: '7' }, query: {}, user: { id: 1 } }), mockRes());
    expect(informes.detalleTecnico.mock.calls[0][0]).toBe('2026-09');
  });

  it('400 con mes o usuario malos; 404 si no existe', async () => {
    for (const [userId, mes] of [['7', '2026-10'], ['7', 'x'], ['abc', '2026-08'], ['0', '2026-08']]) {
      const res = mockRes();
      await getDetalleTecnico(mockReq({ params: { userId }, query: { mes }, user: { id: 1 } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
    informes.detalleTecnico.mockResolvedValue(null);
    const res = mockRes();
    await getDetalleTecnico(mockReq({ params: { userId: '99' }, query: {}, user: { id: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('500 si falla, y llega al panel', async () => {
    informes.detalleTecnico.mockRejectedValue(new Error('BD caída'));
    const res = mockRes();
    await getDetalleTecnico(mockReq({ params: { userId: '7' }, query: {}, user: { id: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: 'BD caída' }));
  });
});
