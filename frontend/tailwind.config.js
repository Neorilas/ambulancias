/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta principal - verde VAPSS
        primary: {
          50:  '#f0fdf4',
          100: '#d8fde1',
          200: '#aff5c0',
          300: '#7de9a0',
          400: '#55CD6C',  // verde corporativo VAPSS
          500: '#2db85a',
          600: '#1a9e44',  // principal (navbar, botones)
          700: '#157a35',
          800: '#105727',
          900: '#0a3a1a',
        },
        // Azul corporativo VAPSS
        vapss: {
          50:  '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#3b82f6',
          500: '#154773',  // azul VAPSS exact
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
