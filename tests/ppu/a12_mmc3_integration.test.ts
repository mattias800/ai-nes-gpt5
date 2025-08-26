import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';
import { MMC3 } from '@core/cart/mappers/mmc3';

// Verify that the PPU's fetch-driven A12 rising edges interact with MMC3 IRQ counter
// deterministically: after setting latch=3, reload-on-next-rise, and enabling IRQ,
// four visible-scanline rises should assert IRQ.

describe('PPU A12 rising edges drive MMC3 IRQ (fetch-driven)', () => {
  it('asserts IRQ after expected number of rises', () => {
    const ppu = new PPU();
    ppu.reset();
    // Enable background rendering so fetches occur on visible scanlines
    ppu.cpuWrite(0x2001, 0x08);

    const prg = new Uint8Array(16 * 0x4000);
    const mmc3 = new MMC3(prg);

    // Wire PPU CHR to mapper and A12 hook to mapper counter
    ppu.connectCHR((a) => mmc3.ppuRead(a), (a, v) => mmc3.ppuWrite(a, v));
    ppu.setA12Hook(() => mmc3.notifyA12Rise());

    // Set latch to 3, request reload on next rise, and enable IRQs
    mmc3.cpuWrite(0xC000, 3);
    mmc3.cpuWrite(0xC001, 0);
    mmc3.cpuWrite(0xE001, 0);

    // First visible scanline rising edge -> reloads to 3 (no IRQ)
    ppu.tick(341);
    expect(mmc3.irqPending!()).toBe(false);
    // Next three rises decrement 3->2->1->0, asserting IRQ on the fourth total rise
    ppu.tick(341);
    expect(mmc3.irqPending!()).toBe(false);
    ppu.tick(341);
    expect(mmc3.irqPending!()).toBe(false);
    ppu.tick(341);
    expect(mmc3.irqPending!()).toBe(true);

    // Clear and verify cleared
    mmc3.clearIrq!();
    expect(mmc3.irqPending!()).toBe(false);
  });
});

