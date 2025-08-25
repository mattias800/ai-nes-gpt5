import { describe, it, expect } from 'vitest';
import { CPUBus } from '@core/bus/memory';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function romWithProgram(bytes: number[]): INesRom {
  const prg = new Uint8Array(0x8000);
  prg.set(bytes, 0);
  // Reset vector to $8000
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  const chr = new Uint8Array(0x2000);
  return { prg, chr, mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('System: PPU ticks at 3x CPU cycles', () => {
  it('NOP (2 cycles) advances PPU by 6 cycles', () => {
    const sys = new NESSystem(romWithProgram([0xEA])); // NOP
    sys.reset();
    const p0 = sys.ppu.cycle;
    sys.stepInstruction();
    const p1 = sys.ppu.cycle;
    expect(p1 - p0).toBe(2 * 3);
  });
});
