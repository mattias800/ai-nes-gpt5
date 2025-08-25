import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

function flags(p: number) {
  return {
    N: !!(p & 0x80),
    V: !!(p & 0x40),
    D: !!(p & 0x08),
    I: !!(p & 0x04),
    Z: !!(p & 0x02),
    C: !!(p & 0x01),
  };
}

describe('CPU: loads/stores/transfers/stack', () => {
  it('LDA immediate sets A and Z/N', () => {
    const { cpu } = cpuWithProgram([
      0xA9, 0x00, // LDA #$00
      0xA9, 0x80, // LDA #$80
    ]);
    cpu.step();
    expect(cpu.state.a).toBe(0x00);
    expect(flags(cpu.state.p).Z).toBe(true);
    cpu.step();
    expect(cpu.state.a).toBe(0x80);
    expect(flags(cpu.state.p).N).toBe(true);
  });

  it('STA/LDX/STX zero-page', () => {
    const { cpu, bus } = cpuWithProgram([
      0xA9, 0x42, // LDA #$42
      0x85, 0x10, // STA $10
      0xA2, 0x00, // LDX #$00
      0xA6, 0x10, // LDX $10 -> X=0x42
      0x86, 0x11, // STX $11 -> 0x42
    ]);
    cpu.step(); cpu.step();
    expect(bus.read(0x0010)).toBe(0x42);
    cpu.step(); cpu.step();
    expect(cpu.state.x).toBe(0x42);
    cpu.step();
    expect(bus.read(0x0011)).toBe(0x42);
  });

  it('TAX/TXA/TAY/TYA/TSX/TXS and PHA/PLA/PHP/PLP', () => {
    const { cpu } = cpuWithProgram([
      0xA9, 0x11, // LDA #$11
      0xAA,       // TAX X=0x11
      0x8A,       // TXA A=0x11
      0xA8,       // TAY Y=0x11
      0x98,       // TYA A=0x11
      0xBA,       // TSX X=S
      0x9A,       // TXS S=X
      0x08,       // PHP (push P)
      0x48,       // PHA (push A)
      0x68,       // PLA -> A
      0x28,       // PLP -> P
    ]);
    // Execute all
    for (let i = 0; i < 11; i++) cpu.step();
    expect(cpu.state.a).toBe(0x11);
    // After PHP/PLP, U bit should be set and B cleared
    expect(cpu.state.p & 0x20).toBe(0x20);
    expect(cpu.state.p & 0x10).toBe(0x00);
  });
});
