import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';
import { MMC3 } from '@core/cart/mappers/mmc3';

// Stress the A12 deglitch filter: only count rises when A12 was low for >=8 PPU cycles
// We manually interleave ppu.tick() (advances dot) and ppuRead() at A12=0/1 addresses.

describe('PPU A12 deglitch stress', () => {
  it('ignores fast A12 toggles and only counts rises after >=8-dot low', () => {
    // Enable telemetry via env before constructing PPU/MMC3
    (process as any).env.PPU_TRACE = '1';
    (process as any).env.MMC3_TRACE = '1';

    const ppu = new PPU();
    const mmc3 = new MMC3(new Uint8Array(0x8000), new Uint8Array(0x2000));
    // Wire CHR space
    ppu.connectCHR((a) => mmc3.ppuRead(a), (a, v) => mmc3.ppuWrite(a, v));
    // Wire A12 hook -> MMC3 IRQ counter
    ppu.setA12Hook(() => mmc3.notifyA12Rise());

    // Start with a known frame state
    ppu.reset();

    const rises = () => mmc3.getTrace().filter(e => e.type === 'A12').length;
    const a12TraceLen = () => ppu.getA12Trace().length;

    // Ensure A12 low read to set lastLowDot
    ;(ppu as any).ppuRead(0x0FF0);

    // Immediate high (no tick) -> ignored
    ;(ppu as any).ppuRead(0x1000);
    expect(rises()).toBe(0);
    expect(a12TraceLen()).toBe(0);

    // 7 dots later -> still ignored (threshold is 8)
    ppu.tick(7);
    ;(ppu as any).ppuRead(0x1000);
    expect(rises()).toBe(0);
    expect(a12TraceLen()).toBe(0);

    // Ensure A12 goes low again before checking the >=8-dot rising edge
    ;(ppu as any).ppuRead(0x0FF0);
    // 8 more dots -> now counts
    ppu.tick(8);
    ;(ppu as any).ppuRead(0x1000);
    expect(rises()).toBe(1);
    expect(a12TraceLen()).toBe(1);

    // Go low again and test threshold again
    ;(ppu as any).ppuRead(0x0F00);
    ppu.tick(8);
    ;(ppu as any).ppuRead(0x1000); // now ok after full 8-dot low
    expect(rises()).toBe(2);
  });
});

