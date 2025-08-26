import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

// Point Vite to the browser host directory where index.html lives
export default defineConfig({
  root: 'src/host/browser',
  appType: 'spa',
  plugins: [tsconfigPaths()],
  server: {
    open: true,
  },
})

