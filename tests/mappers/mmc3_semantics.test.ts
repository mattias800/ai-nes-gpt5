import { describe, it, expect } from 'vitest';
import { MMC3 } from '@core/cart/mappers/mmc3';

const make = () => {
  const m = new MMC3(new Uint8Array(0x8000), new Uint8Array(0x2000));
  // Freeze time at visible line (not pre-render)
  (m as any).setTimeProvider?.(() => ({ frame: 0, scanline: 0, cycle: 0 }));
  return m as any;
};

const A12 = (m: any) => m.notifyA12Rise();
const C000 = (m: any, v: number) => m.cpuWrite(0xC000 as any, v & 0xFF);
const C001 = (m: any) => m.cpuWrite(0xC001 as any, 0);
const E000 = (m: any) => m.cpuWrite(0xE000 as any, 0);
const E001 = (m: any) => m.cpuWrite(0xE001 as any, 0);

describe('MMC3 semantics (unit)', () => {
  it('dec-to-zero asserts when enabled', () => {
    const m = make();
    E000(m); // disable
    C000(m, 1); // latch=1
    C001(m); // request reload on next clock
    E001(m); // enable
    expect(m.irqPending()).toBe(false);
    // First A12: reload-after-clear (to 1), MUST NOT assert
    A12(m);
    expect(m.irqPending()).toBe(false);
    // Second A12: decrement 1->0, should assert
    A12(m);
    expect(m.irqPending()).toBe(true);
  });

  it('reload-after-clear to zero does not assert', () => {
    const m = make();
    E000(m);
    C000(m, 0); // latch=0
    C001(m);
    E001(m);
    // First A12: load 0 due to reloadPending, but should not assert
    A12(m);
    expect(m.irqPending()).toBe(false);
  });

  it('reload-when-counter-zero does not assert even if latch==0 (base semantics)', () => {
    const m = make();
    E001(m);
    C000(m, 0);
    A12(m);
    expect(m.irqPending()).toBe(false);
  });
});

