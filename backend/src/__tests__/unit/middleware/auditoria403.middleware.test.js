'use strict';

const { EventEmitter } = require('events');

jest.mock('../../../controllers/admin.controller', () => ({ logAudit: jest.fn() }));
const { logAudit } = require('../../../controllers/admin.controller');
const { auditarAccesosDenegados } = require('../../../middleware/auditoria403.middleware');

/** res mínimo que emite 'finish' como el de Express. */
function resFalso() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = jest.fn(() => res);
  return res;
}

function responder(req, status, cuerpo) {
  const res = resFalso();
  const next = jest.fn();
  auditarAccesosDenegados(req, res, next);
  expect(next).toHaveBeenCalled();
  res.status(status).json(cuerpo);
  res.emit('finish');
}

const USER = { id: 9, username: 'jlopez' };

describe('auditoria403.middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  it('audita el 403 de un controlador con su motivo y sin la query', () => {
    responder({ user: USER, method: 'GET', originalUrl: '/api/v1/vehicles/3?x=1', ip: '1.2.3.4', headers: {} },
      403, { success: false, message: 'No tienes acceso a este vehículo' });

    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 9, action: 'access_denied',
      details: { method: 'GET', url: '/api/v1/vehicles/3', motivo: 'No tienes acceso a este vehículo' },
    }));
  });

  it('no audita otras respuestas', () => {
    responder({ user: USER, method: 'GET', originalUrl: '/x', headers: {} }, 200, {});
    responder({ user: USER, method: 'GET', originalUrl: '/x', headers: {} }, 404, {});
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('no duplica lo que requirePermission/requireFeature ya auditaron', () => {
    responder({ user: USER, _accesoDenegadoAuditado: true, method: 'GET', originalUrl: '/x', headers: {} }, 403, {});
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('sin usuario autenticado no hay a quién atribuirlo', () => {
    responder({ user: null, method: 'GET', originalUrl: '/x', headers: {} }, 403, {});
    expect(logAudit).not.toHaveBeenCalled();
  });
});
