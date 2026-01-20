/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        argus: {
          bg: '#0a0d12',
          card: '#151c24',
          border: '#1c252f',
          accent: '#f97316',
          'accent-light': '#fb923c',
          danger: '#ef4444',
          warning: '#f59e0b',
        },
        storm: {
          950: '#0a0d12',
          900: '#0f1419',
          800: '#151c24',
          700: '#1c252f',
          600: '#242f3a',
          500: '#3d4f5f',
        },
      },
      fontFamily: {
        myth: ['Cinzel', 'serif'],
      },
    },
  },
  plugins: [],
};
