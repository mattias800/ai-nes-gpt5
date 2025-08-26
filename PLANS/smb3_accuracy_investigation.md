# SMB3 Accuracy Investigation and Test Plan

Objective
- Diagnose and fix remaining SMB3 issues with automated, deterministic tests and minimal manual intervention.
- Prioritize correctness and repeatability (rule: Correctness). Ensure run-until-completion automation for verification.

High-level strategy
1) Lock timing mode to VT in tests and harnesses. Ensure PPU odd-frame skip, copyY gating, A12 deglitch are exercised.
2) Use ROM-driven invariants instead of golden images where possible: NMI/IRQ service counts, MMC3 write presence, A12 rises.
3) Add deeper SMB3 harnesses: input scripts with checkpoints, state CRC snapshots, IRQ presence, and trace-auto-dumps on failure.
4) Constrain tracer memory to prevent perf stalls; make tests fast and bounded.

Instrumentation to leverage
- PPU.getA12Trace(): bounded list of A12 rises (frame, scanline, cycle) under PPU_TRACE=1.
- MMC3.getTrace(): list of mapper register writes and A12 notifications; will cap growth.
- CPU.setTraceHook(): ring tail of executed PCs/opcodes for failure dumps.

Accuracy hypotheses to validate
- MMC3 IRQ reload/enable semantics (C000/C001/E000/E001) match (reload on next A12 rise, not immediate).
- A12 rise deglitch filter matches implementation (min low dots before counting next rise).
- PPU copyY at prerender lines gated by rendering enable (cycles 280-304), verified already but rechecked under SMB3 flows.
- NMI gating behavior: NMI only serviced when enabled, edge during VBlank respected.

Automated tests to add
A) SMB3 IRQ presence invariant (ROM-required, optional):
   - Within N frames after enabling rendering, at least one MMC3 IRQ service occurs, MMC3 writes present, and A12 rises observed.
   - Count IRQ service by monitoring CPU PC hitting IRQ vector address.

B) Extended SMB3 input script checkpoints (already present):
   - Expand checkpoints for later-in-game segments (map movement, early 1-1) with CRCs.

C) Mapper trace bounding (implementation change):
   - Cap MMC3 trace length to avoid quadratic scans and memory growth.

Failure diagnostics
- On any invariant failure, dump: tail CPU trace, head of MMC3 trace, head of A12 trace, framebuffer CRC, and state sample CRC.
- Provide a gen-repro script (already present) to reproduce from traces as needed.

Execution plan (initial steps)
1) Bound MMC3 trace growth in code.
2) Add new SMB3 IRQ presence invariant test.
3) Run slow suite and accuracy report to validate no regressions and obtain summary.
4) If failures, capture auto dumps and iterate with focused unit tests (e.g., MMC3 IRQ gating edge cases) before changing core.

Success criteria
- SMB3 boot/title/deep/state/extended-input tests pass.
- SMB3 IRQ presence invariant passes deterministically with local ROM.
- No performance stalls; tests complete under default frame budgets.

