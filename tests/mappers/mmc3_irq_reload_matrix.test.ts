import { describe, it, expect } from 'vitest';
import { MMC3 } from '@core/cart/mappers/mmc3';

// Validate reload-on-next-rise semantics and enable/disable interactions beyond basic tests.

describe('MMC3 IRQ reload/enable matrix', () => {
  it('C001 requests reload on next A12 rise even if counter is non-zero', () => {
    const m = new MMC3(new Uint8Array(0x8000));
    // latch=3
    m.cpuWrite(0xC000, 3);
    // Enable
    m.cpuWrite(0xE001, 0);
    // First rise: counter=3 (reload)
    m.notifyA12Rise();
    // Next: dec to 2
    m.notifyA12Rise();
    // Now request reload
    m.cpuWrite(0xC001, 0);
    // Next: should reload to 3, not 1
    m.notifyA12Rise();
    // Next dec to 2 again
    m.notifyA12Rise();
    // Next dec to 1
    m.notifyA12Rise();
    // Next dec to 0 -> IRQ
    expect(m.irqPending && m.irqPending()).toBe(false);
    m.notifyA12Rise();
    expect(m.irqPending && m.irqPending()).toBe(true);
  });

  it('Late enable does not retro-assert IRQ for prior zero transition', () => {
    const m = new MMC3(new Uint8Array(0x8000));
    m.cpuWrite(0xC000, 1); // latch=1 so reload->1, next ->0
    m.cpuWrite(0xE000, 0); // disable
    m.cpuWrite(0xC001, 0); // request reload
    m.notifyA12Rise(); // reload to 1
    m.notifyA12Rise(); // dec to 0 while disabled -> no IRQ
    expect(m.irqPending && m.irqPending()).toBe(false);
    // Enable now
    m.cpuWrite(0xE001, 0);
    // Next rise reloads to 1; then next dec to 0 -> IRQ
    m.notifyA12Rise(); // reload
    expect(m.irqPending && m.irqPending()).toBe(false);
    m.notifyA12Rise(); // dec to 0 -> IRQ
    expect(m.irqPending && m.irqPending()).toBe(true);
  });
});
