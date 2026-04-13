'use strict';

const { apiLimiter, loginLimiter, refreshLimiter, uploadLimiter } = require('../../../middleware/rateLimiter.middleware');

describe('rateLimiter.middleware', () => {
  it('exports all limiters as functions', () => {
    expect(typeof apiLimiter).toBe('function');
    expect(typeof loginLimiter).toBe('function');
    expect(typeof refreshLimiter).toBe('function');
    expect(typeof uploadLimiter).toBe('function');
  });

  it('limiters have middleware signature (req, res, next)', () => {
    // Express middleware is a function with length 3
    expect(apiLimiter.length).toBeLessThanOrEqual(3);
    expect(loginLimiter.length).toBeLessThanOrEqual(3);
  });
});
