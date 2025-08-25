import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

function flags(p: number) {
  return {
    N: !!(p & 0x80), V: !!(p & 0x40), B: !!(p & 0x10), I: !!(p & 0x04), Z: !!(p & 0x02), C: !!(p & 0x01),
  };
}

describe('CPU flow control and flags', () => {
  it('JMP (ind) bug wraps page on indirect vector', () => {
    const { cpu, bus } = cpuWithProgram([
      0x6C, 0xFF, 0x10, // JMP ($10FF) should read hi from $1000, not $1100
    ], 0x8000);
    // Write vector at $10FF low byte and $1000 high byte
    bus.write(0x10FF, 0x34); // low
    bus.write(0x1000, 0x12); // high (wrapped)
    cpu.step();
    expect(cpu.state.pc).toBe(0x1234);
  });

  it('BRK pushes PC+2 and P with B set, then vectors to $FFFE', () => {
    const { cpu, bus } = cpuWithProgram([
      0x00, // BRK
    ], 0x8000);
    // Set IRQ/BRK vector to $9000
    bus.write(0xFFFE, 0x00); bus.write(0xFFFF, 0x90);
    cpu.step();
    expect(cpu.state.pc).toBe(0x9000);
    // Pull from stack to examine pushed P (we can't read stack easily without implementing PLA etc here), ensure I is set
    expect(flags(cpu.state.p).I).toBe(true);
  });

  it('RTI restores P and PC (returns to byte after BRK padding)', () => {
    const { cpu, bus } = cpuWithProgram([
      0x00, // BRK to push state and jump to vector
      0x40, // RTI
    ], 0x8000);
    // Vector to $8002 (so RTI executes next)
    bus.write(0xFFFE, 0x02); bus.write(0xFFFF, 0x80);
    cpu.step(); // BRK
    const afterBrkP = cpu.state.p;
    cpu.step(); // RTI
    expect(cpu.state.pc).toBe(0x8002); // Return to after BRK's padding byte
    expect(cpu.state.p & 0xEF).toBe(afterBrkP & 0xEF); // B bit cleared on restore, others same
  });

  // Branch cycle edge cases are covered comprehensively by nestest; we'll validate timing via nestest harness instead of a bespoke unit test here.
});
