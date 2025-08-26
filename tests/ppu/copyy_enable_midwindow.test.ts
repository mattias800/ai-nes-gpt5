import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

function writePPUSCROLL(ppu: PPU, x: number, y: number) {
  ppu.cpuWrite(0x2005, x & 0xFF);
  ppu.cpuWrite(0x2005, y & 0xFF);
}

function setPPUCTRL(ppu: PPU, val: number) { ppu.cpuWrite(0x2000, val & 0xFF); }

// Helper to compute the Y bits mask (.IHGF.ED CBA.....) from v
function yBits(v: number) { return v & 0x7BE0; }

describe('PPU copyY pre-render mid-window enable (vt)', () => {
  it('enabling rendering during 280..304 copies Y from t into v', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    // Prepare t with fineY=5, coarseY=7 and nametable Y = 1
    writePPUSCROLL(ppu, 0, (7 << 3) | 5);
    setPPUCTRL(ppu, 0x02);

    // Rendering disabled initially
    ppu.cpuWrite(0x2001, 0x00);

    // Advance to pre-render scanline start
    ppu.tick(261 * 341);
    // Advance to cycle ~282
    ppu.tick(282);

    // Enable background to allow copyY
    ppu.cpuWrite(0x2001, 0x08);
    // Stay within window
    ppu.tick(10);

    // Read v and t Y bits should match
    const v = (ppu as any).v as number;
    const t = (ppu as any).t as number;
    expect(yBits(v)).toBe(yBits(t));
  });

  it('enabling rendering after 304 does not copy Y on that pre-render line', () => {
    const ppu = new PPU();
    ppu.reset();
    ppu.setTimingMode('vt');

    writePPUSCROLL(ppu, 0, (9 << 3) | 6);
    setPPUCTRL(ppu, 0x00);

    // Ensure rendering disabled during entire 280..304
    ppu.cpuWrite(0x2001, 0x00);

    ppu.tick(261 * 341);
    ppu.tick(306); // move just past window

    // Enable after window
    ppu.cpuWrite(0x2001, 0x08);

    const v = (ppu as any).v as number;
    const t = (ppu as any).t as number;
    // v Y bits should still differ from t (since there was no copyY)
    expect(yBits(v)).not.toBe(yBits(t));
  });
});

