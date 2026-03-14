/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta principal - verde corporativo VAPSS (#468847)
        primary: {
          50:  '#f2f9f2',
          100: '#ddf0de',
          200: '#b9e0bb',
          300: '#8cc990',
          400: '#64af68',
          500: '#468847',  // verde VAPSS exacto (web)
          600: '#3a7040',  // principal (navbar, botones)
          700: '#2e5832',
          800: '#214023',
          900: '#152815',
        },
        // Azul corporativo VAPSS
        vapss: {
          50:  '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#3b82f6',
          500: '#154773',  // azul VAPSS exacto (links web)
          600: '#1e3a5f',
          700: '#162d4a',
          800: '#0f1f33',
          900: '#081220',
        },
        // Gris neutro para UI
        neutral: {
          50:  '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      screens: {
        xs: '375px',  // iPhone SE
      },
    },
  },
  plugins: [],
};
