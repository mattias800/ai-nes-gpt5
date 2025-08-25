import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

// Sanity test for NOP to ensure harness and CPU step work

describe('CPU: NOP', () => {
  it('executes NOP and advances PC + cycles', () => {
    const { cpu } = cpuWithProgram([
      0xEA, // NOP
      0xEA, // NOP
    ]);
    const startPC = cpu.state.pc;
    cpu.step();
    expect(cpu.state.pc).toBe((startPC + 1) & 0xFFFF);
    expect(cpu.state.cycles).toBeGreaterThan(0);
    cpu.step();
    expect(cpu.state.pc).toBe((startPC + 2) & 0xFFFF);
  });
});
