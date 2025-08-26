import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

// Verify that length counters clock on half-frame edges precisely for 4-step and 5-step modes

describe('APU frame counter: half-frame length timing', () => {
  it('4-step: length decrements at edges 1 and 3 (7457, 14916) only', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Configure 4-step mode (also resets frame sequence)
    sys.io.write(0x4017, 0x00);

    // Enable pulse1 with a known length; halt off
    sys.io.write(0x4015, 0x01);
    sys.io.write(0x4000, 0x00); // halt=0, constant=0, duty=0
    sys.io.write(0x4002, 0x00);
    sys.io.write(0x4003, 0x00); // length index=0 -> 10

    const apu: any = sys.apu as any;
    const initial = apu['pulse1Length'] as number;

    // Just before first quarter edge (3729) -> no change
    sys.apu.tick(3728);
    expect(apu['pulse1Length']).toBe(initial);

    // At first quarter edge (3729) -> no length clock
    sys.apu.tick(1);
    expect(apu['pulse1Length']).toBe(initial);

    // Move to just before half-frame edge at 7457
    sys.apu.tick(7457 - 3729 - 1); // 3727
    expect(apu['pulse1Length']).toBe(initial);

    // Cross half-frame edge (7457) -> decrement by 1
    sys.apu.tick(1);
    expect(apu['pulse1Length']).toBe(initial - 1);

    // Next quarter-only edge at 11186 should not change length
    sys.apu.tick(11186 - 7457 - 1); // just before
    expect(apu['pulse1Length']).toBe(initial - 1);
    sys.apu.tick(1); // at 11186
    expect(apu['pulse1Length']).toBe(initial - 1);

    // Next half-frame edge at 14916 -> decrement again
    sys.apu.tick(14916 - 11186 - 1); // just before
    expect(apu['pulse1Length']).toBe(initial - 1);
    sys.apu.tick(1); // at 14916
    expect(apu['pulse1Length']).toBe(initial - 2);
  });

  it('5-step: length decrements at edges 1 and 4 (7457, 18641) only, no frame IRQ', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Configure 5-step mode (IRQ inhibited), resets sequence
    sys.io.write(0x4017, 0x80);

    // Enable pulse1 with known length
    sys.io.write(0x4015, 0x01);
    sys.io.write(0x4000, 0x00);
    sys.io.write(0x4002, 0x00);
    sys.io.write(0x4003, 0x00); // length 10

    const apu: any = sys.apu as any;
    const initial = apu['pulse1Length'] as number;

    // Edge 0 (3729) quarter: no length change
    sys.apu.tick(3729);
    expect(apu['pulse1Length']).toBe(initial);

    // Edge 1 (7457) half: decrement
    sys.apu.tick(7457 - 3729);
    expect(apu['pulse1Length']).toBe(initial - 1);

    // Edge 2 (11186) quarter: no length change
    sys.apu.tick(11186 - 7457);
    expect(apu['pulse1Length']).toBe(initial - 1);

    // Edge 3 (14916) quarter (in 5-step mode, half-frame occurs at 1 and 4): no change
    sys.apu.tick(14916 - 11186);
    expect(apu['pulse1Length']).toBe(initial - 1);

    // Edge 4 (18641) half: decrement again
    sys.apu.tick(18641 - 14916);
    expect(apu['pulse1Length']).toBe(initial - 2);

    // No frame IRQ in 5-step mode
    const st = sys.io.read(0x4015);
    expect((st & 0x40) !== 0).toBe(false);
  });
});

