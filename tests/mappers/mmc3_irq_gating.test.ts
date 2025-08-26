import { describe, it, expect } from 'vitest';
import { MMC3 } from '@core/cart/mappers/mmc3';

// Verify MMC3 IRQ enable/disable gating and reload/decrement behavior across A12 rises

describe('MMC3 IRQ enable/disable gating', () => {
  it('does not assert when disabled and asserts when re-enabled after appropriate rises', () => {
    const prg = new Uint8Array(16 * 0x4000);
    const m = new MMC3(prg);

    // latch=1 so it takes two rises from reload to assert (reload->1, then dec->0)
    m.cpuWrite(0xC000, 1);
    m.cpuWrite(0xC001, 0); // request reload on next rise

    // Enable IRQs
    m.cpuWrite(0xE001, 0);

    // First rise: reload to 1 (no IRQ)
    m.notifyA12Rise();
    expect(m.irqPending!()).toBe(false);
    // Second rise: 1->0 with enable -> IRQ
    m.notifyA12Rise();
    expect(m.irqPending!()).toBe(true);
    m.clearIrq!();
    expect(m.irqPending!()).toBe(false);

    // Disable IRQs
    m.cpuWrite(0xE000, 0);

    // Counter currently 0; next rise will reload to 1, then next dec to 0 but disabled -> no IRQ
    m.notifyA12Rise(); // reload
    expect(m.irqPending!()).toBe(false);
    m.notifyA12Rise(); // dec to 0, disabled -> no IRQ
    expect(m.irqPending!()).toBe(false);

    // Re-enable
    m.cpuWrite(0xE001, 0);

    // With counter==0, next rise reloads to 1; next after that dec to 0 and now enabled -> IRQ
    m.notifyA12Rise(); // reload
    expect(m.irqPending!()).toBe(false);
    m.notifyA12Rise(); // dec to 0 -> IRQ
    expect(m.irqPending!()).toBe(true);
  });
});

