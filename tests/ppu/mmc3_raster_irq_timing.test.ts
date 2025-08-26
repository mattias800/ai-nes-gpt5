import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';
import { MMC3 } from '@core/cart/mappers/mmc3';

function tickLines(ppu: PPU, n: number) {
  for (let i = 0; i < n; i++) ppu.tick(341);
}

describe('MMC3 raster IRQ timing with rendering', () => {
  it('asserts IRQ on expected scanline based on latch after reload', () => {
    const ppu = new PPU();
    ppu.reset();
    // Enable background rendering so PPU issues A12 rises on visible scanlines (cycle ~260)
    ppu.cpuWrite(0x2001, 0x08);

    const mmc3 = new MMC3(new Uint8Array(16 * 0x4000));
    // Wire PPU CHR and A12 hook to MMC3
    ppu.connectCHR((a) => mmc3.ppuRead(a), (a, v) => mmc3.ppuWrite(a, v));
    ppu.setA12Hook(() => mmc3.notifyA12Rise());

    // Set latch=1, request reload, enable IRQ
    mmc3.cpuWrite(0xC000, 1);
    mmc3.cpuWrite(0xC001, 0);
    mmc3.cpuWrite(0xE001, 0);

    // First visible scanline rising edge (line 0): reloads to 1
    tickLines(ppu, 1);
    expect(mmc3.irqPending!()).toBe(false);

    // Second rising edge (line 1): 1->0 and asserts IRQ
    tickLines(ppu, 1);
    expect(mmc3.irqPending!()).toBe(true);
    mmc3.clearIrq!();

    // Subsequent pattern: since counter was 0 at last rise, next rise reloads to latch (1)
    tickLines(ppu, 1); // line 2 -> reload to 1
    expect(mmc3.irqPending!()).toBe(false);
    tickLines(ppu, 1); // line 3 -> 1->0 -> IRQ
    expect(mmc3.irqPending!()).toBe(true);
  });

  it('disabling rendering suppresses A12 pulses and thus no IRQs occur', () => {
    const ppu = new PPU();
    ppu.reset();
    // Rendering disabled (mask defaults to 0)

    const mmc3 = new MMC3(new Uint8Array(16 * 0x4000));
    ppu.connectCHR((a) => mmc3.ppuRead(a), (a, v) => mmc3.ppuWrite(a, v));
    ppu.setA12Hook(() => mmc3.notifyA12Rise());

    mmc3.cpuWrite(0xC000, 1);
    mmc3.cpuWrite(0xC001, 0);
    mmc3.cpuWrite(0xE001, 0);

    // Tick many lines without rendering; no A12 pulses -> no IRQ
    tickLines(ppu, 8);
    expect(mmc3.irqPending!()).toBe(false);
  });
});

