module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/__tests__/**',
    '!src/utils/logger.utils.js',
    '!src/config/database.js',
    '!src/routes/**',
  ],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: { branches: 80, functions: 85, lines: 85, statements: 85 },
  },
  setupFiles: [
    '<rootDir>/src/__tests__/env-setup.js',
    '<rootDir>/src/__tests__/setup.js',
  ],
};
