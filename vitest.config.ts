import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const r = (p: string) => path.resolve(__dirname, p);

export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000,
    hookTimeout: 30000,
    globals: true,
    reporters: ['default'],
  },
  resolve: {
    alias: {
      '@core': r('src/core'),
      '@host': r('src/host'),
      '@utils': r('src/utils'),
      '@test': r('tests'),
    },
  },
});
