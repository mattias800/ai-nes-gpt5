import { describe, it, expect } from 'vitest';
import type { INesRom } from '@core/cart/ines';
import { NESSystem } from '@core/system/system';

function makeRom(code: number[]): INesRom {
  const prg = new Uint8Array(0x8000).fill(0xEA); // default NOPs
  prg.set(code, 0x0000);
  // Reset vector -> $8000
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

function totalPpuTicks(sys: NESSystem): number {
  return sys.ppu.frame * 262 * 341 + sys.ppu.scanline * 341 + sys.ppu.cycle;
}

describe('System timing invariants', () => {
  it('PPU advances exactly 3x CPU cycles across mixed instructions incl. OAM DMA', () => {
    // Program: NOP x2, LDA #$00, STA $4014 (OAM DMA stall), NOP x2, then loop with JMP $8000
    const code = [
      0xEA, 0xEA,             // NOP, NOP
      0xA9, 0x00,             // LDA #$00
      0x8D, 0x14, 0x40,       // STA $4014 (OAM DMA)
      0xEA, 0xEA,             // NOP, NOP
      0x4C, 0x00, 0x80,       // JMP $8000
    ];
    const sys = new NESSystem(makeRom(code));
    sys.reset();

    const steps = 50; // enough iterations over loop to include multiple DMAs
    const cpu0 = sys.cpu.state.cycles;
    const ppu0 = totalPpuTicks(sys);

    for (let i = 0; i < steps; i++) {
      sys.stepInstruction();
    }

    const cpu1 = sys.cpu.state.cycles;
    const ppu1 = totalPpuTicks(sys);
    const cpuDelta = cpu1 - cpu0;
    const ppuDelta = ppu1 - ppu0;

    expect(cpuDelta).toBeGreaterThan(0);
    expect(ppuDelta).toBe(cpuDelta * 3);
  });
});

