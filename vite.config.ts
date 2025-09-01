import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import path from 'node:path'

// Point Vite to the browser host directory where index.html lives
export default defineConfig({
  root: 'src/host/browser',
  appType: 'spa',
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      '@core': path.resolve(process.cwd(), 'src/core'),
      '@host': path.resolve(process.cwd(), 'src/host'),
      '@utils': path.resolve(process.cwd(), 'src/utils'),
      '@test': path.resolve(process.cwd(), 'tests'),
    },
  },
  server: {
    open: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  },
})

