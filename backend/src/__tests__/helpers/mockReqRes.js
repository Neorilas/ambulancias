'use strict';

/**
 * Factory for mock Express req/res/next objects.
 */
function mockReq(overrides = {}) {
  return {
    params: {},
    query: {},
    body: {},
    headers: {},
    ip: '127.0.0.1',
    user: null,
    file: null,
    files: null,
    processedFile: null,
    get: jest.fn((h) => overrides.headers?.[h.toLowerCase()]),
    ...overrides,
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    _json: null,
    status: jest.fn(function (code) { this.statusCode = code; return this; }),
    json: jest.fn(function (data) { this._json = data; return this; }),
    send: jest.fn(function (data) { return this; }),
    set: jest.fn(function () { return this; }),
  };
  return res;
}

function mockNext() {
  return jest.fn();
}

module.exports = { mockReq, mockRes, mockNext };
