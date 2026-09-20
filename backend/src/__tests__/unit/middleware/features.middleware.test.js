'use strict';

/**
 * Tests de middleware/features.middleware.js
 *
 * Lo que se fija aquí es que el flag es un control de acceso DE VERDAD y no un
 * adorno del menú: hasta que apareció el mapa de flota, los feature flags solo
 * vivían en el frontend, y ocultar una entrada del menú no impide llamar al
 * endpoint a mano.
 */

const { query } = require('../../../config/database');

jest.mock('../../../controllers/admin.controller', () => ({
  logAudit: jest.fn(),
  logError: jest.fn(),
}));

const { logAudit } = require('../../../controllers/admin.controller');
const { requireFeature, featureActiva } = require('../../../middleware/features.middleware');
const { mockReq, mockRes, mockNext } = require('../../helpers/mockReqRes');

const superadmin = { id: 1, username: 'findelias', roles: ['superadmin'] };
const admin      = { id: 2, username: 'fjtamayo',  roles: ['administrador'] };

/** La fila de `app_features` con el flag encendido o apagado. */
const flag = (enabled) => [[{ enabled }]];

describe('featureActiva', () => {
  beforeEach(() => query.mockReset());

  it('lee el flag de app_features por su clave', async () => {
    query.mockResolvedValueOnce(flag(1));
    await expect(featureActiva('menu_flota')).resolves.toBe(true);
    expect(query.mock.calls[0][1]).toEqual(['menu_flota']);
  });

  it('apagado es apagado', async () => {
    query.mockResolvedValueOnce(flag(0));
    await expect(featureActiva('menu_flota')).resolves.toBe(false);
  });

  it('un flag que no existe cuenta como apagado, no como abierto', async () => {
    query.mockResolvedValueOnce([[]]);
    await expect(featureActiva('menu_inventado')).resolves.toBe(false);
  });
});

describe('requireFeature', () => {
  beforeEach(() => {
    query.mockReset();
    logAudit.mockClear();
  });

  it('el superadmin pasa SIN mirar el flag', async () => {
    // Mismo bypass que hace `hasPermission`. Si aquí se comportara distinto,
    // el superadmin no podría comprobar lo que acaba de encender.
    const next = mockNext();
    await requireFeature('menu_flota')(mockReq({ user: superadmin }), mockRes(), next);

    expect(next).toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('un administrador pasa con el flag encendido', async () => {
    query.mockResolvedValueOnce(flag(1));
    const next = mockNext();
    await requireFeature('menu_flota')(mockReq({ user: admin }), mockRes(), next);

    expect(next).toHaveBeenCalled();
  });

  it('un administrador NO pasa con el flag apagado, aunque llame al endpoint a mano', async () => {
    // Este es el caso que justifica todo el fichero: el menú oculto no
    // protege nada por sí solo.
    query.mockResolvedValueOnce(flag(0));
    const res = mockRes();
    const next = mockNext();
    await requireFeature('menu_flota')(mockReq({ user: admin }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('el intento denegado queda en auditoría', async () => {
    query.mockResolvedValueOnce(flag(0));
    await requireFeature('menu_flota')(
      mockReq({ user: admin, method: 'GET', originalUrl: '/api/v1/flota/ubicaciones' }),
      mockRes(), mockNext()
    );

    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: 2,
      action: 'access_denied',
      details: expect.objectContaining({ feature: 'menu_flota' }),
    }));
  });

  it('sin usuario no pasa nadie', async () => {
    const res = mockRes();
    const next = mockNext();
    await requireFeature('menu_flota')(mockReq({ user: null }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('si la base de datos falla, DENIEGA', async () => {
    // Ante la duda no se enseña dónde está la flota. Un fallo de BD que
    // concediera acceso sería la peor forma posible de abrir esta pantalla.
    query.mockRejectedValueOnce(new Error('DB down'));
    const res = mockRes();
    const next = mockNext();
    await requireFeature('menu_flota')(mockReq({ user: admin }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('un fallo al auditar no cambia la respuesta', async () => {
    query.mockResolvedValueOnce(flag(0));
    logAudit.mockImplementationOnce(() => { throw new Error('auditoría rota'); });
    const res = mockRes();
    await requireFeature('menu_flota')(mockReq({ user: admin }), res, mockNext());

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
