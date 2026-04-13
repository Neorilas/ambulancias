jest.mock('../config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
  testConnection: jest.fn().mockResolvedValue(true),
  pool: { getConnection: jest.fn() },
}));

jest.mock('../utils/logger.utils', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  http: jest.fn(),
  verbose: jest.fn(),
}));
