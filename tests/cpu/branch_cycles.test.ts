import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

// Verify branch cycle counts for taken/not-taken and page-crossing cases.
// 6502 rules:
// - Branch not taken: 2 cycles
// - Branch taken (no page cross): 3 cycles
// - Branch taken with page cross: 4 cycles

describe('CPU: branch cycle counts (BNE)', () => {
  it('BNE not taken = 2 cycles', () => {
    const { cpu, bus } = cpuWithProgram([0xD0, 0x00], 0x8000); // BNE +0 (ignored)
    // Set Z flag so BNE is not taken
    cpu.state.p |= 0x02; // Z=1
    cpu.step();
    expect(cpu.state.cycles).toBe(2);
    // PC advanced by 2
    expect(cpu.state.pc).toBe(0x8002);
  });

  it('BNE taken same page = 3 cycles', () => {
    const { cpu, bus } = cpuWithProgram([0xD0, 0x02, 0xEA, 0xEA], 0x8000); // BNE +2; NOP; NOP
    // Clear Z so BNE is taken
    cpu.state.p &= ~0x02; // Z=0
    cpu.step();
    expect(cpu.state.cycles).toBe(3);
    // Target = $8000+2+2 = $8004
    expect(cpu.state.pc).toBe(0x8004);
  });

  it('BNE taken with page cross = 4 cycles', () => {
    // Place BNE at $80FD so PC+2 = $80FF; offset +2 => $8101 (page cross)
    const { cpu, bus } = cpuWithProgram([], 0x80FD);
    bus.write(0x80FD, 0xD0); // BNE
    bus.write(0x80FE, 0x02); // +2
    // Fill the bytes at $80FF and $8100 for completeness
    bus.write(0x80FF, 0xEA); // NOP
    bus.write(0x8100, 0xEA); // NOP

    cpu.state.p &= ~0x02; // Z=0 (branch taken)
    cpu.step();
    expect(cpu.state.cycles).toBe(4);
    expect(cpu.state.pc).toBe(0x8101);
  });
});

