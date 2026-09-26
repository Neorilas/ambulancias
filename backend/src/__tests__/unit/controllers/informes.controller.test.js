'use strict';

jest.mock('../../../services/informes.service', () => {
  const real = jest.requireActual('../../../services/informes.service');
  return { ...real, obtenerInforme: jest.fn() };
});
jest.mock('../../../utils/fecha.utils', () => ({
  ...jest.requireActual('../../../utils/fecha.utils'),
  ahora: () => new Date('2026-09-27T10:00:00.000Z'),
}));

const informes = require('../../../services/informes.service');
const { getInformeMensual } = require('../../../controllers/informes.controller');
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
  });
});
