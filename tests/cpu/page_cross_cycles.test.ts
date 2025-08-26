import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

describe('CPU: page-cross cycle increments', () => {
  it('LDA abs,X adds +1 cycle on page cross', () => {
    const { cpu, bus } = cpuWithProgram([
      0xBD, 0xFF, 0x00, // LDA $00FF,X (X=1) -> reads $0100, page cross
    ], 0x8000);
    cpu.state.x = 1;
    bus.write(0x0100, 0x42);
    cpu.step();
    // Base 4 cycles + 1 cross = 5
    expect(cpu.state.cycles).toBe(5);
    expect(cpu.state.a).toBe(0x42);
  });

  it('LDA (zp),Y adds +1 cycle on page cross', () => {
    const { cpu, bus } = cpuWithProgram([
      0xB1, 0x80, // LDA ($80),Y
    ], 0x8000);
    // Set pointer at $80 -> $00FF; Y=1 crosses into $0100
    bus.write(0x0080, 0xFF); bus.write(0x0081, 0x00);
    bus.write(0x0100, 0x99);
    cpu.state.y = 1;
    cpu.step();
    // Base 5 cycles + 1 cross = 6
    expect(cpu.state.cycles).toBe(6);
    expect(cpu.state.a).toBe(0x99);
  });
});
