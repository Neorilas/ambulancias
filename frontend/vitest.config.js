import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.js'],
    include: ['src/__tests__/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/__tests__/**',
        'src/main.jsx',
        // El service worker no se puede montar en jsdom: no hay `self`, ni
        // registration, ni PushEvent. Sus dos piezas con lógica de verdad
        // (leer el payload del push y componer la ruta del aviso) viven a
        // propósito en utils/swAvisos.js, que sí se prueba.
        'src/sw.js',
        'src/index.css',
        'src/App.jsx',
        'src/pages/**',
        'src/components/**',
      ],
      thresholds: {
        statements: 85,
        branches: 75,
        functions: 85,
        lines: 85,
      },
    },
  },
});
