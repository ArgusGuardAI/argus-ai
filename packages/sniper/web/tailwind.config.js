/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        whale: {
          50: '#e6f9ff',
          100: '#b3ecff',
          200: '#80dfff',
          300: '#4dd2ff',
          400: '#1ac5ff',
          500: '#00a8e8',
          600: '#0088cc',
          700: '#006699',
          800: '#004466',
          900: '#002233',
        },
        cyber: {
          blue: '#00d4ff',
          purple: '#7b2cbf',
          pink: '#ff006e',
        },
        dark: {
          950: '#050508',
          900: '#0a0a0f',
          800: '#0f0f18',
          700: '#151520',
          600: '#1a1a28',
        },
      },
      fontFamily: {
        cyber: ['Orbitron', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
