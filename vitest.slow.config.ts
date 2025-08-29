import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/**/*.slow.test.ts'],
    threads: false,
    maxConcurrency: 1,
    isolate: true,
    clearMocks: true,
    testTimeout: 120_000,
    hookTimeout: 30_000,
    reporters: ['default'],
  },
});
