import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

function writePPUSCROLL(ppu: PPU, x: number, y: number) {
  ppu.cpuWrite(0x2005, x & 0xFF);
  ppu.cpuWrite(0x2005, y & 0xFF);
}

function yBits(v: number) { return v & 0x7BE0; }

// incY edges at dot 256 for coarseY=29 (toggle NT Y) and coarseY=31 (no toggle)
describe('PPU incY wrap edges (vt)', () => {
  it('coarseY=29 with fineY=7 toggles vertical nametable and wraps coarseY to 0', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // Set t: fineY=7, coarseY=29; then copyY to v
    writePPUSCROLL(ppu, 0, (29 << 3) | 7);
    (ppu as any).copyY();

    // Sanity check initial v fields
    const vInit = (ppu as any).v as number;
    expect((vInit >> 12) & 0x07).toBe(7);
    expect((vInit >> 5) & 0x1F).toBe(29);

    // Directly invoke incY to validate behavior
    (ppu as any).incY();

    const v1 = (ppu as any).v as number;
    const coarseY = (v1 >> 5) & 0x1F;
    const fineY = (v1 >> 12) & 0x07;
    const ntY = (v1 >> 11) & 1;

    expect(coarseY).toBe(0);
    expect(fineY).toBe(0);
    expect(ntY).toBe(1);
  });

  it('coarseY=31 with fineY=7 wraps to 0 without toggling vertical nametable', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // Set t: fineY=7, coarseY=31, ntY=1 via PPUCTRL; then copyY to v
    ppu.cpuWrite(0x2000, 0x02);
    writePPUSCROLL(ppu, 0, (31 << 3) | 7);
    (ppu as any).copyY();

    const vInit = (ppu as any).v as number;
    expect((vInit >> 12) & 0x07).toBe(7);
    expect((vInit >> 5) & 0x1F).toBe(31);

    (ppu as any).incY();

    const v1 = (ppu as any).v as number;
    const coarseY = (v1 >> 5) & 0x1F;
    const fineY = (v1 >> 12) & 0x07;
    const ntY = (v1 >> 11) & 1;

    expect(coarseY).toBe(0);
    expect(fineY).toBe(0);
    expect(ntY).toBe(1);
  });
});

