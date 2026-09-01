/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta principal - azul corporativo suave.
        // Solo aparece en: barra superior, item activo del menu y accion principal.
        primary: {
          50:  '#eff6ff',
          100: '#dbeafe',
          200: '#c7dbff',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',  // principal (navbar, botones) — azul equilibrado
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        // Gris de UI con sesgo azul, para que se lea como familia del primary
        neutral: {
          50:  '#f5f7fa',
          100: '#eef1f6',
          200: '#e3e8f0',
          300: '#cfd6e2',
          400: '#aab4c4',
          500: '#8592a8',
          600: '#5d6a80',
          700: '#47536b',
          800: '#2a3446',
          900: '#101623',
        },
        // Colores semanticos de estado. NO se usan con ningun otro fin:
        // ok = finalizado/correcto · warn = programado/proximo · bad = incidencia/vencido
        ok:   { 50: '#eaf6ee', 200: '#c3e6ce', 500: '#3d9b5f', 600: '#15803d', 700: '#136c34' },
        warn: { 50: '#fdf4e7', 200: '#f2ddb8', 500: '#e0a53a', 600: '#b45309', 700: '#96460a' },
        bad:  { 50: '#fdeeee', 200: '#f3cccc', 500: '#d24545', 600: '#c02626', 700: '#a11f1f' },
        idle: { 50: '#f2f4f8', 200: '#e0e5ee', 500: '#98a2b3', 600: '#6b7686' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // Datos: matriculas, kilometros, fechas e identificadores
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        lg: '0.5rem',   // 8px — radio estandar de tarjetas
        xl: '0.5rem',   // las .card antiguas usaban 12px; se unifican en 8px
      },
      screens: {
        xs: '375px',  // iPhone SE
      },
    },
  },
  plugins: [],
};
