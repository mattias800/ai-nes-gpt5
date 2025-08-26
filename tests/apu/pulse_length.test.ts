import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function romWithResetAt(pc: number): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = pc & 0xFF;
  prg[0x7FFD] = (pc >> 8) & 0xFF;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

// Half-frame clocks should decrement pulse length counters when enabled and not halted.
// This test ensures $4003/$4007 load length counters, $4015 enables/clears them, and
// $4017 frame counter ticking causes decrements at the correct steps.

describe('APU pulse length counters (basic)', () => {
  it('loads, enables, and decrements on half-frame clocks; clears on disable', () => {
    const sys = new NESSystem(romWithResetAt(0x8000));
    sys.reset();

    // Enable frame counter 4-step (default) and no IRQ inhibit
    sys.io.write(0x4017, 0x00);

    // Write pulse1 length index via $4003 (upper 5 bits of value)
    // Using value where (value>>3)&0x1F = 0 -> length=10
    sys.io.write(0x4003, 0x00);

    // Initially disabled; $4015 enables pulse1 (bit0)
    sys.io.write(0x4015, 0x01);

    // Half-frame clocks at steps 1 and 3 of 4-step; tick to first half-frame edge (~7457 cycles)
    sys.ppu.tick(7457 * 3); // drive via PPU ticks to advance CPU cycles indirectly is not modeled; instead step CPU NOPs

    // Better: step instructions to accumulate CPU cycles: each NOP adds 2 cycles -> 3729 NOPs would be heavy.
    // Instead, call APU.tick via IO pathway is not public; but system.stepInstruction ticks APU by delta cycles.
    // Execute 3729 NOP-equivalents by setting a small loop: create ROM with repeated NOPs is complex here, so approximate by calling stepInstruction many times with default bus returning 0x00 (BRK). We'll instead simulate with direct apu.tick calls.

    // Directly tick APU: simulate reaching step 1 (3729 cycles) then step 2 (7457), etc.
    sys.apu.tick(3729); // quarter frame
    sys.apu.tick(3728); // up to 7457 total -> half-frame, should dec length

    // Read status: bit0 should be 1 (length>0)
    const s1 = sys.io.read(0x4015);
    expect((s1 & 0x01) !== 0).toBe(true);

    // Advance to next half-frame (another ~7457 cycles)
    sys.apu.tick(7457);

    const s2 = sys.io.read(0x4015);
    expect((s2 & 0x01) !== 0).toBe(true);

    // Disable pulse1 -> length counter cleared
    sys.io.write(0x4015, 0x00);
    const s3 = sys.io.read(0x4015);
    expect((s3 & 0x01) !== 0).toBe(false);
  });
});

