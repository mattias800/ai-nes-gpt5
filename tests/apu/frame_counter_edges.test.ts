import { describe, it, expect } from 'vitest';
import { APU } from '@core/apu/apu';

describe('APU frame counter edge behavior', () => {
  it('writing $4017 with bit6=1 (IRQ inhibit) clears pending frame IRQ in 4-step mode', () => {
    const apu = new APU();
    apu.reset();

    // Enable 4-step mode with IRQs enabled
    apu.write4017(0x00);
    // Advance to set frame IRQ flag (slightly beyond sequence end)
    apu.tick(15000);
    expect((apu.read4015() & 0x40) !== 0).toBe(true);

    // Inhibit IRQs; this should also clear the pending flag
    apu.write4017(0x40);
    expect((apu.read4015() & 0x40) !== 0).toBe(false);
  });
});

