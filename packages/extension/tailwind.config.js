/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{tsx,ts,jsx,js}'],
  theme: {
    extend: {
      colors: {
        // WhaleShield brand colors (matching website)
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
        // Risk colors
        safe: '#22c55e',
        suspicious: '#eab308',
        dangerous: '#f97316',
        scam: '#ef4444',
      },
      fontFamily: {
        cyber: ['Orbitron', 'sans-serif'],
      },
      animation: {
        'glow-pulse': 'glow-pulse 2s ease-in-out infinite',
        'scan-line': 'scan-line 3s linear infinite',
      },
      keyframes: {
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(0, 212, 255, 0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(0, 212, 255, 0.6)' },
        },
        'scan-line': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
      },
    },
  },
  plugins: [],
};
