import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

// Verify incY behavior at cycle 256 (vt mode): fine Y wraps and coarse Y increments,
// with vertical nametable switch at coarseY==29.

describe('PPU incY vertical wrap in vt mode', () => {
  it('wraps fineY and coarseY at cycle 256; toggles vertical nametable when coarseY was 29', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // Enable rendering so per-dot timing runs
    ppu.cpuWrite(0x2001, 0x08);

    // Set t via $2005 for fineY=7, coarseY=29; then copyY to v
    ppu.cpuWrite(0x2005, 0x00); // X scroll (ignored here)
    ppu.cpuWrite(0x2005, ((29 & 0x1F) << 3) | (7 & 0x07));
    (ppu as any).copyY();

    // Sanity check initial v fields
    const v0 = (ppu as any).v as number;
    expect((v0 >> 12) & 0x07).toBe(7);
    expect((v0 >> 5) & 0x1F).toBe(29);
    expect((v0 >> 11) & 0x01).toBe(0);

    // Directly invoke incY to validate its behavior without per-dot timing noise
    (ppu as any).incY();

    const vAfter = (ppu as any).v as number;
    const fineY = (vAfter >> 12) & 0x07;
    const coarseY = (vAfter >> 5) & 0x1F;
    const ntY = (vAfter >> 11) & 0x01;

    expect(fineY).toBe(0);
    expect(coarseY).toBe(0);
    expect(ntY).toBe(1); // toggled
  });
});

