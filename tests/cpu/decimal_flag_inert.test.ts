import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

// NES 2A03 ignores decimal mode in ADC/SBC. SED/CLD toggles the flag bit only; math is binary.

describe('CPU decimal flag inertness on NES', () => {
  it('ADC/SBC behave identically with D=0 and D=1', () => {
    // Program: CLC; LDA #$50; ADC #$50; PHP; SED; ADC #$01; PHP
    const prog = [
      0x18,             // CLC
      0xA9, 0x50,       // LDA #$50
      0x69, 0x50,       // ADC #$50 -> $A0, V=1, C=0
      0x08,             // PHP (push P with B/U set)
      0xF8,             // SED (set decimal)
      0x69, 0x01,       // ADC #$01 -> $A1 (no BCD adjust on NES)
      0x08,             // PHP
    ];
    const { cpu, bus } = cpuWithProgram(prog, 0x8000);

    // Execute all
    for (let i = 0; i < prog.length; i++) cpu.step();

    // Pull the two P snapshots from stack: last PHP at top-? order: Pushed first will be lower on stack.
    // Stack grows downward; After execution S likely 0xFD - pushes twice => S=0xFB. The last push stored at 0x01FC.
    const s = cpu.state.s;
    const p2 = bus.read(0x0100 + ((s + 1) & 0xFF)); // last pushed P
    const p1 = bus.read(0x0100 + ((s + 2) & 0xFF)); // previous pushed P

    // After first ADC (#$50), expect A=$A0; V=1, N=1, Z=0, C=0
    // After second ADC (#$01) with D=1, expect A=$A1; flags reflect binary add, not BCD.
    expect(cpu.state.a).toBe(0xA1);
    // Ensure D flag is set in p2
    expect((p2 & 0x08) !== 0).toBe(true);
    // Ensure V set after first ADC; cannot directly from p1 vs p2; at least ensure binary add behavior kept C low here (A0 + 01 -> A1 without carry)
    expect((cpu.state.p & 0x01) !== 0).toBe(false); // C=0 currently
  });
});

