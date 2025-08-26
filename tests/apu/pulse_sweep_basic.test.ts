import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

// Basic pulse sweep tests: verifies that enabling sweep adjusts timer period over half-frame edges

describe('APU pulse sweep (basic)', () => {
  it('pulse1 sweep increases or decreases period depending on negate bit', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // 4-step mode
    sys.io.write(0x4017, 0x00);

    // Enable pulse1 with a starting timer period
    sys.io.write(0x4015, 0x01);
    sys.io.write(0x4000, 0x00); // envelope doesn't matter
    sys.io.write(0x4002, 0x34);
    sys.io.write(0x4003, 0x01); // timer high=1 -> period = 0x134

    const apu: any = sys.apu as any;
    const base = apu['pulse1TimerPeriod'] as number;

    // Enable sweep: period=0 (immediate on next half-frame), shift=1, negate=0 (increase)
    sys.io.write(0x4001, 0b1000_0001); // enable=1, period=0, negate=0, shift=1

    // First half-frame at 7457 only reloads sweep divider; no change yet
    sys.apu.tick(7457);
    const afterReload = apu['pulse1TimerPeriod'] as number;
    expect(afterReload).toBe(base);
    // Next half-frame at 14916 applies sweep
    sys.apu.tick(14916 - 7457);
    const inc = apu['pulse1TimerPeriod'] as number;
    expect(inc).toBeGreaterThan(base);

    // Now set negate=1 and reload sweep; expect decrease on the following half-frame
    sys.io.write(0x4001, 0b1000_1001); // enable=1, period=0, negate=1, shift=1
    const beforeDec = apu['pulse1TimerPeriod'] as number;
    // First half-frame: reload only
    sys.apu.tick(7457);
    // Next half-frame: apply
    sys.apu.tick(14916 - 7457);
    const dec = apu['pulse1TimerPeriod'] as number;
    expect(dec).toBeLessThanOrEqual(beforeDec);
  });

  it('pulse2 sweep works similarly (no pulse1 extra adjust on negate)', () => {
    const sys = new NESSystem(rom());
    sys.reset();
    sys.io.write(0x4017, 0x00);

    sys.io.write(0x4015, 0x02);
    sys.io.write(0x4004, 0x00);
    sys.io.write(0x4006, 0x40);
    sys.io.write(0x4007, 0x02); // period ~0x240

    const apu: any = sys.apu as any;
    const base = apu['pulse2TimerPeriod'] as number;
    sys.io.write(0x4005, 0b1000_0001); // enable, period=0, negate=0, shift=1
    // First half-frame: reload only
    sys.apu.tick(7457);
    const afterReload = apu['pulse2TimerPeriod'] as number;
    expect(afterReload).toBe(base);
    // Next half-frame: apply
    sys.apu.tick(14916 - 7457);
    const inc = apu['pulse2TimerPeriod'] as number;
    expect(inc).toBeGreaterThan(base);

    sys.io.write(0x4005, 0b1000_1001); // negate=1
    const beforeDec = apu['pulse2TimerPeriod'] as number;
    // First half-frame: reload only
    sys.apu.tick(7457);
    // Next half-frame: apply
    sys.apu.tick(14916 - 7457);
    const dec = apu['pulse2TimerPeriod'] as number;
    expect(dec).toBeLessThanOrEqual(beforeDec);
  });
});

