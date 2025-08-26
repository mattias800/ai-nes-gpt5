import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      'tests/slow/**',
      'node_modules/**',
      // Exclude moved slow files still present as placeholders
      'tests/harness/framebuffer_bg_smoke.test.ts',
      'tests/harness/framebuffer_full_smoke.test.ts',
      'tests/harness/screenshot.test.ts',
      'tests/harness/long_run_mario_trace.test.ts',
      'tests/ppu/odd_frame_scaffold.test.ts',
      'tests/ppu/split_scroll_y_midframe.test.ts',
      'tests/ppu/sprite_priority.test.ts',
      'tests/ppu/sprite_priority_left_mask.test.ts',
      'tests/ppu/sprite_overflow.test.ts',
    ],
    coverage: {
      enabled: false,
    },
  },
})

