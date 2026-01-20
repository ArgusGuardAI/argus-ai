import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8787',
        ws: true,
      },
      '/jupiter': {
        target: 'https://quote-api.jup.ag',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/jupiter/, ''),
        secure: true,
      },
      '/pumpfun': {
        target: 'https://pumpportal.fun',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/pumpfun/, ''),
        secure: true,
      },
    },
  },
});
