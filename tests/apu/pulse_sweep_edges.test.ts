import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

// Edge cases for APU pulse sweep behavior
// - shift=0 should be a no-op even when enabled
// - timerPeriod < 8 should prevent updates (high pitch guard)
// - overflow target > 0x7FF should not apply
// - negate behavior: pulse1 subtracts delta+1, pulse2 subtracts delta

describe('APU pulse sweep edge cases', () => {
  it('shift=0 causes no change when sweep clocks', () => {
    const sys = new NESSystem(rom());
    sys.reset();
    sys.io.write(0x4017, 0x00); // 4-step
    sys.io.write(0x4015, 0x01); // enable pulse1
    sys.io.write(0x4000, 0x00);
    sys.io.write(0x4002, 0x34);
    sys.io.write(0x4003, 0x01); // base period ~0x134
    const apu: any = sys.apu as any;
    const base = apu['pulse1TimerPeriod'] as number;

    // Enable sweep with shift=0
    sys.io.write(0x4001, 0b1000_0000); // enable=1, period=0, negate=0, shift=0
    sys.apu.tick(7457);                // reload only
    sys.apu.tick(14916 - 7457);        // would apply if shift>0
    const cur = apu['pulse1TimerPeriod'] as number;
    expect(cur).toBe(base);
  });

  it('period <= 7 prevents output updates (no apply) on clock', () => {
    const sys = new NESSystem(rom());
    sys.reset();
    sys.io.write(0x4017, 0x00);
    sys.io.write(0x4015, 0x01);
    sys.io.write(0x4000, 0x00);
    // Set tiny period: 0x0007
    sys.io.write(0x4002, 0x07);
    sys.io.write(0x4003, 0x00);
    const apu: any = sys.apu as any;
    const base = apu['pulse1TimerPeriod'] as number;

    sys.io.write(0x4001, 0b1000_0001); // enable, shift=1
    sys.apu.tick(7457);                // reload
    sys.apu.tick(14916 - 7457);        // apply would happen, but period<8 blocks
    const cur = apu['pulse1TimerPeriod'] as number;
    expect(cur).toBe(base);
  });

  it('overflow target > 0x7FF does not apply update', () => {
    const sys = new NESSystem(rom());
    sys.reset();
    sys.io.write(0x4017, 0x00);
    sys.io.write(0x4015, 0x02); // enable pulse2 for this check
    sys.io.write(0x4004, 0x00);
    // Choose a large period close to max so that adding delta overflows > 0x7FF
    // e.g., period=0x7F0, shift=1 => delta=0x3F8, target=0xBE8 (>0x7FF)
    sys.io.write(0x4006, 0xF0);
    sys.io.write(0x4007, 0x0F);
    const apu: any = sys.apu as any;
    const base = apu['pulse2TimerPeriod'] as number;

    sys.io.write(0x4005, 0b1000_0001); // enable, shift=1 (negate=0)
    sys.apu.tick(7457);                // reload
    sys.apu.tick(14916 - 7457);        // attempt apply -> should be blocked due to overflow
    const cur = apu['pulse2TimerPeriod'] as number;
    expect(cur).toBe(base);
  });

  it('negate differs: pulse1 subtracts delta+1, pulse2 subtracts delta', () => {
    // Pulse1
    {
      const sys = new NESSystem(rom());
      sys.reset();
      sys.io.write(0x4017, 0x00);
      sys.io.write(0x4015, 0x01);
      sys.io.write(0x4000, 0x00);
      // period = 0x200
      sys.io.write(0x4002, 0x00);
      sys.io.write(0x4003, 0x04);
      const apu: any = sys.apu as any;
      const base = apu['pulse1TimerPeriod'] as number; // 0x200
      // shift=1 => delta=0x100; negate => expect base - delta - 1 = 0x0FF
      sys.io.write(0x4001, 0b1000_1001);
      sys.apu.tick(7457);
      sys.apu.tick(14916 - 7457);
      const cur = apu['pulse1TimerPeriod'] as number;
      expect(cur).toBe(((base - (base >> 1) - 1) & 0x7FF));
    }

    // Pulse2
    {
      const sys = new NESSystem(rom());
      sys.reset();
      sys.io.write(0x4017, 0x00);
      sys.io.write(0x4015, 0x02);
      sys.io.write(0x4004, 0x00);
      // period = 0x200
      sys.io.write(0x4006, 0x00);
      sys.io.write(0x4007, 0x04);
      const apu: any = sys.apu as any;
      const base = apu['pulse2TimerPeriod'] as number;
      sys.io.write(0x4005, 0b1000_1001);
      sys.apu.tick(7457);
      sys.apu.tick(14916 - 7457);
      const cur = apu['pulse2TimerPeriod'] as number;
      expect(cur).toBe(((base - (base >> 1)) & 0x7FF));
    }
  });
});

