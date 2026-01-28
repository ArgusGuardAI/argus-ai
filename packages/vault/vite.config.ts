import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3001, // Different port for local dev
  },
  build: {
    // Minimal build - no code splitting, single bundle
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
});
