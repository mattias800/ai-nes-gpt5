Place public test ROMs here (ignored by git). A fetch script will populate:
- nestest.nes
- nestest.log
- other blargg/ppu/mmc3 tests as configured

---

Slow harness and MMC3 timeout controls

Long-running tests and harnesses are now bounded by wall-clock time. You can tune this via environment variables.

Global harness wall timeout (milliseconds)
- HARNESS_WALL_TIMEOUT_MS
  - Applies to most long-running harness tests (framebuffer smoke, SMB3 runs, screenshots, etc.).
  - Defaults vary by test, but are typically between 120000 (2 min) and 900000 (15 min).
  - Example: HARNESS_WALL_TIMEOUT_MS=180000 vitest run tests/slow/**/*.test.ts

MMC3-specific timeouts and budgets
- MMC3_WALL_TIMEOUT_MS (ms): Wall-clock timeout for MMC3 slow tests/suites.
- MMC3_TIMEOUT_SECONDS (s): Logical cycle budget (CPU_HZ × seconds). Default: 60s.
- MMC3_TIMEOUT_CYCLES (cycles): Absolute cycle budget override. If set, this wins over MMC3_TIMEOUT_SECONDS.
- MMC3_CPU_HZ: CPU clock used to derive cycle budgets. Default: 1789773 (NTSC).

Examples
- Bound all slow harnesses to 3 minutes:
  HARNESS_WALL_TIMEOUT_MS=180000 npm run test:slow

- Run a single MMC3 timing test for up to 5 minutes wall time and 45 seconds of CPU time:
  MMC3_WALL_TIMEOUT_MS=300000 MMC3_TIMEOUT_SECONDS=45 vitest run tests/slow/mmc3_suite_4_timing_only.test.ts

- Use a fixed cycle cap (overrides seconds):
  MMC3_TIMEOUT_CYCLES=25000000 vitest run tests/slow/mmc3_suite_1_clocking_only.test.ts

Notes
- On wall timeout or cycle budget exhaustion, tests fail with a clear timeout message and print concise diagnostics (e.g., A12 and MMC3 trace tails) to aid debugging.
- Each test also declares a Vitest per-test timeout so the runner can preempt even if the loop is busy.
