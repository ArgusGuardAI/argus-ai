import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'packages/agents/src/**/*.ts',
        'packages/monitor/src/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/index.ts',
      ],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@argus/agents': '/packages/agents/src',
      '@argus/monitor': '/packages/monitor/src',
    },
  },
});
