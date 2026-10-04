'use strict';

/**
 * Un multipart roto no tumba la API (SEC-15).
 *
 * multer 1.x dejaba escapar excepciones fuera de la cadena de Express con un
 * campo de nombre vacío o un cuerpo cortado, y tiraba el proceso entero. Y
 * `npm audit` no lo veía: 1.4.5-lts.2 es una versión prerelease y no casa con
 * el rango de los avisos. Aquí se manda lo malformado a una subida real y se
 * comprueba que contesta con un error y que el servidor sigue respondiendo.
 */

const http    = require('http');
const express = require('express');
const request = require('supertest');
const { query } = require('../../config/database');
const { generateAccessToken } = require('../../utils/jwt.utils');
const { errorHandler } = require('../../middleware/error.middleware');
const router = require('../../routes');

const app = express();
app.use(express.json({ limit: '10mb' }));   // como server.js
app.use('/api/v1', router);
app.use(errorHandler);

const TOKEN = generateAccessToken({ id: 7, username: 'prueba', roles: ['tecnico'] });
const URL_SUBIDA = '/api/v1/asignaciones/1/evidencias';
const BOUNDARY = 'xYzLimite';

function multipartCrudo(cuerpo) {
  return request(app)
    .post(URL_SUBIDA)
    .set('Authorization', `Bearer ${TOKEN}`)
    .set('Content-Type', `multipart/form-data; boundary=${BOUNDARY}`)
    .send(cuerpo);
}

// Es culpa de la petición: un 4xx, y nada en error_logs (un 5xx sí se
// grabaría, y cualquiera podría llenar la tabla mandando subidas rotas).
function esUn4xxSinRastroEnErrorLogs(res) {
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  expect(query.mock.calls.some(([sql]) => /INSERT INTO error_logs/.test(sql))).toBe(false);
}

describe('subida con multipart malformado (SEC-15)', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockImplementation(async (sql) => {
      if (/GROUP_CONCAT[\s\S]*FROM users u/.test(sql)) {
        return [[{ id: 7, username: 'prueba', nombre: 'P', apellidos: 'P', activo: 1, deleted_at: null, roles: 'tecnico' }]];
      }
      return [[]];
    });
  });

  afterEach(async () => {
    // El proceso sigue vivo y atiende la siguiente petición
    const res = await request(app).get('/api/v1/');
    expect(res.status).toBe(200);
  });

  it('un campo con el nombre vacío da un error, no una caída', async () => {
    const res = await multipartCrudo(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name=""\r\n\r\nx\r\n--${BOUNDARY}--\r\n`
    );
    esUn4xxSinRastroEnErrorLogs(res);
  });

  it('un cuerpo cortado a mitad del fichero da un error, no una caída', async () => {
    const res = await multipartCrudo(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="image"; filename="a.jpg"\r\n`
      + 'Content-Type: image/jpeg\r\n\r\n\xff\xd8\xff\xe0 sin cierre'
    );
    esUn4xxSinRastroEnErrorLogs(res);
    // Sale de busboy como Error genérico: sin subirImagen era un 500
    expect(res.status).toBe(400);
  });

  it('una cabecera de parte sin Content-Disposition da un error, no una caída', async () => {
    const res = await multipartCrudo(`--${BOUNDARY}\r\nX-Otra: y\r\n\r\nx\r\n--${BOUNDARY}--\r\n`);
    esUn4xxSinRastroEnErrorLogs(res);
  });
});

describe('POST /errores-cliente: tope de tamaño del cuerpo (SEC-16)', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockImplementation(async (sql) => {
      if (/GROUP_CONCAT[\s\S]*FROM users u/.test(sql)) {
        return [[{ id: 7, username: 'prueba', nombre: 'P', apellidos: 'P', activo: 1, deleted_at: null, roles: '' }]];
      }
      if (/COUNT\(\*\) AS hoy/.test(sql)) return [[{ hoy: 0 }]];
      return [[]];
    });
  });

  it('un cuerpo de más de 256 KB da 413 aunque no lleve content-length (chunked)', async () => {
    const grande = JSON.stringify({ errores: [{ tipo: 'js', mensaje: 'x'.repeat(300 * 1024) }] });
    const servidor = app.listen(0);
    try {
      const status = await new Promise((resolve, reject) => {
        // Sin content-length: Node lo manda con Transfer-Encoding: chunked
        const req = http.request({
          port: servidor.address().port, method: 'POST', path: '/api/v1/errores-cliente',
          headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        }, (res) => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject);
        req.write(grande.slice(0, 1000));
        req.end(grande.slice(1000));
      });
      expect(status).toBe(413);
    } finally {
      servidor.close();
    }
  });

  it('un lote normal pasa', async () => {
    const res = await request(app)
      .post('/api/v1/errores-cliente')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ errores: [{ tipo: 'js', mensaje: 'x' }] });
    expect(res.status).toBe(202);
  });
});
