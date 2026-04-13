process.env.JWT_ACCESS_SECRET  = 'test-access-secret-32chars-minimum!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-32chars-minimum!';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_MAX_REQUESTS = '10000';
process.env.LOGIN_RATE_LIMIT_MAX = '10000';
process.env.BCRYPT_ROUNDS = '4'; // Fast for tests
