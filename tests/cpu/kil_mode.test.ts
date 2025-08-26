import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

// Verify strict vs lenient behavior for KIL/JAM opcodes ($02, etc.)

describe('CPU KIL/JAM strict vs lenient modes', () => {
  it('strict mode: jams CPU (no further cycles progress)', () => {
    const { cpu } = cpuWithProgram([
      0x02, // KIL
      0xEA, // NOP (should never execute)
    ]);
    (cpu as any).setIllegalMode('strict');
    const c0 = cpu.state.cycles;
    cpu.step();
    expect(cpu.state.cycles).toBe(c0); // no cycles added on jam
    const c1 = cpu.state.cycles;
    cpu.step();
    expect(cpu.state.cycles).toBe(c1); // still jammed, no cycles
  });

  it('lenient mode: treats KIL as 2-cycle NOP and continues', () => {
    const { cpu } = cpuWithProgram([
      0x02, // KIL -> NOP(2 cycles)
      0xEA, // NOP
    ]);
    (cpu as any).setIllegalMode('lenient');
    const c0 = cpu.state.cycles;
    cpu.step();
    expect(cpu.state.cycles - c0).toBe(2);
    const c1 = cpu.state.cycles;
    cpu.step();
    expect(cpu.state.cycles - c1).toBe(2);
  });
});

