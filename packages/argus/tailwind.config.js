/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sentinel: {
          bg: '#0a0a0f',
          card: '#12121a',
          border: '#1e1e2e',
          accent: '#00ff88',
          danger: '#ff4444',
          warning: '#ffaa00',
        },
      },
    },
  },
  plugins: [],
};
