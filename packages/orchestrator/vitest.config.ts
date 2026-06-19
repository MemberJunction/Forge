import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Tests exercise the compiled output in dist/, so build before running.
    globals: false,
  },
});
