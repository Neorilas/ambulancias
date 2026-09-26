'use strict';

/**
 * Tests de controllers/csp.controller.js — informes de la CSP del frontend.
 * El logger va mockeado en setup.js: aquí se mira qué se registra y qué no.
 */

const logger = require('../../../utils/logger.utils');
const { recibirInforme, extraerInformes, recortarUri, _vistos } =
  require('../../../controllers/csp.controller');
const { mockReq, mockRes } = require('../../helpers/mockReqRes');

const INFORME_CLASICO = {
  'csp-report': {
    'document-uri':       'https://vapss.net/app/vehiculos?token=secreto',
    'effective-directive': 'img-src',
    'blocked-uri':        'https://tiles.ejemplo.com/1/2/3.png?k=abc',
  },
};

describe('csp.controller', () => {
  beforeEach(() => { jest.clearAllMocks(); _vistos.clear(); });

  it('responde 204 y registra la violación sin la query string', () => {
    const res = mockRes();
    recibirInforme(mockReq({ body: INFORME_CLASICO }), res);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const linea = logger.warn.mock.calls[0][0];
    expect(linea).toContain('img-src');
    expect(linea).toContain('https://tiles.ejemplo.com/1/2/3.png');
    expect(linea).not.toContain('secreto');
    expect(linea).not.toContain('k=abc');
  });

  it('la misma violación repetida se registra una sola vez', () => {
    recibirInforme(mockReq({ body: INFORME_CLASICO }), mockRes());
    recibirInforme(mockReq({ body: INFORME_CLASICO }), mockRes());
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('entiende el formato de la Reporting API', () => {
    const informes = extraerInformes([
      { type: 'csp-violation', body: { effectiveDirective: 'script-src-elem', blockedURL: 'inline', documentURL: 'https://vapss.net/app/' } },
      { type: 'deprecation',   body: {} },
    ]);
    expect(informes).toHaveLength(1);
    expect(informes[0].directiva).toBe('script-src-elem');
  });

  it('un cuerpo basura no rompe nada: 204 y sin log', () => {
    const res = mockRes();
    recibirInforme(mockReq({ body: 'no es json' }), res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('recortarUri deja las palabras clave cortas y tal cual', () => {
    expect(recortarUri('eval')).toBe('eval');
    expect(recortarUri(undefined)).toBe('-');
  });
});
