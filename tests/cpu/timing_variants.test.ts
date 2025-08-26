import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

// Validates instruction timing for indexed addressing modes and RMW memory ops,
// focusing on extra cycles when crossing page boundaries and RMW cycle counts.

describe('CPU: timing for addressing modes and RMW', () => {
  it('LDA abs,X adds +1 cycle only when page crosses; none when it does not', () => {
    // Case 1: no cross
    {
      const { cpu, bus } = cpuWithProgram([
        0xA2, 0x01,       // LDX #$01 (2)
        0xBD, 0xFE, 0x00, // LDA $00FE,X -> $00FF (4, no cross)
      ], 0x8000);
      bus.write(0x00FF, 0x55);
      cpu.step(); // LDX
      cpu.step(); // LDA
      expect(cpu.state.cycles).toBe(2 + 4);
      expect(cpu.state.a).toBe(0x55);
    }
    // Case 2: cross
    {
      const { cpu, bus } = cpuWithProgram([
        0xA2, 0x01,       // LDX #$01 (2)
        0xBD, 0xFF, 0x00, // LDA $00FF,X -> $0100 (4 + 1)
      ], 0x8000);
      bus.write(0x0100, 0x66);
      cpu.step(); // LDX
      cpu.step(); // LDA
      expect(cpu.state.cycles).toBe(2 + 5);
      expect(cpu.state.a).toBe(0x66);
    }
  });

  it('LDA (zp),Y adds +1 cycle on cross; none otherwise', () => {
    // no cross
    {
      const { cpu, bus } = cpuWithProgram([
        0xA0, 0x01, // LDY #$01 (2)
        0xB1, 0x80, // LDA ($80),Y -> base=$00FE, addr=$00FF (5, no cross)
      ], 0x8000);
      bus.write(0x0080, 0xFE); bus.write(0x0081, 0x00);
      bus.write(0x00FF, 0x77);
      cpu.step(); // LDY
      cpu.step(); // LDA
      expect(cpu.state.cycles).toBe(2 + 5);
      expect(cpu.state.a).toBe(0x77);
    }
    // cross
    {
      const { cpu, bus } = cpuWithProgram([
        0xA0, 0x01, // LDY #$01 (2)
        0xB1, 0x80, // LDA ($80),Y -> base=$00FF, addr=$0100 (5+1)
      ], 0x8000);
      bus.write(0x0080, 0xFF); bus.write(0x0081, 0x00);
      bus.write(0x0100, 0x88);
      cpu.step(); // LDY
      cpu.step(); // LDA
      expect(cpu.state.cycles).toBe(2 + 6);
      expect(cpu.state.a).toBe(0x88);
    }
  });

  it('ASL abs takes 6 cycles; ASL abs,X takes 7 cycles', () => {
    const { cpu, bus } = cpuWithProgram([
      0x0E, 0x00, 0x20, // ASL $2000 (6)
      0x1E, 0x00, 0x20, // ASL $2000,X (7)
    ], 0x8000);
    bus.write(0x2000, 0x80);
    // First ASL abs
    cpu.step();
    expect(cpu.state.cycles).toBe(6);
    expect(bus.read(0x2000)).toBe(0x00);
    // Set X=1 and run abs,X (value now 0 from prior)
    cpu.state.x = 1;
    cpu.step();
    expect(cpu.state.cycles).toBe(6 + 7);
  });
});

