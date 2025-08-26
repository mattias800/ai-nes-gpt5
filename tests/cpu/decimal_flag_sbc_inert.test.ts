import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

// NES decimal flag inertness: SBC must behave identically regardless of D

describe('CPU decimal flag inertness on NES (SBC)', () => {
  it('SBC behaves the same with D=0 and D=1', () => {
    // Program: LDA #$50; SEC; SBC #$10; PHP; SED; SEC; SBC #$01; PHP
    const prog = [
      0xA9, 0x50,       // LDA #$50
      0x38,             // SEC (prepare no borrow)
      0xE9, 0x10,       // SBC #$10 -> $40
      0x08,             // PHP (snapshot flags)
      0xF8,             // SED (set decimal)
      0x38,             // SEC (again)
      0xE9, 0x01,       // SBC #$01 -> $3F
      0x08,             // PHP
    ];
    const { cpu, bus } = cpuWithProgram(prog, 0x8000);

    for (let i = 0; i < prog.length; i++) cpu.step();

    expect(cpu.state.a).toBe(0x3F);
    const s = cpu.state.s;
    const p2 = bus.read(0x0100 + ((s + 1) & 0xFF));
    // Ensure decimal flag was set for second snapshot
    expect((p2 & 0x08) !== 0).toBe(true);
  });
});

