import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

function writeAddr(ppu: PPU, addr: number) {
  ppu.cpuWrite(0x2006, (addr >> 8) & 0xFF);
  ppu.cpuWrite(0x2006, addr & 0xFF);
}

function writePPU(ppu: PPU, addr: number, val: number) {
  writeAddr(ppu, addr);
  ppu.cpuWrite(0x2007, val & 0xFF);
}

describe.skip('Debug scroll sampling', () => {
  it('sampleBgPixel and sampleBgColor at (0,0) after coarseX=31 fineX=0 are non-zero and FB[0]==1 with wrap setup', () => {
    const ppu = new PPU();
    ppu.reset();

    // CHR with tile 1 lo=0xFF on all rows, tile 2 hi=0xFF on all rows
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) chr[(1 << 4) + y] = 0xFF; // tile 1 -> pix=1
    for (let y = 0; y < 8; y++) chr[(2 << 4) + 8 + y] = 0xFF; // tile 2 -> pix=2
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    // BG palette: 0,1,2,3 -> identity
    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x01);
    writePPU(ppu, 0x3F02, 0x02);
    writePPU(ppu, 0x3F03, 0x03);

    // Attr tables zero for NT0 and NT1
    for (let i = 0; i < 64; i++) writePPU(ppu, 0x23C0 + i, 0x00);
    for (let i = 0; i < 64; i++) writePPU(ppu, 0x27C0 + i, 0x00);

    // Fill NT0 col 31 with tile 1; NT1 col 0 with tile 2
    for (let row = 0; row < 30; row++) {
      writePPU(ppu, 0x2000 + row * 32 + 31, 1);
      writePPU(ppu, 0x2400 + row * 32 + 0, 2);
    }
    // Sanity: direct VRAM check for first row writes
    expect((ppu as any).vram[0x001F]).toBe(1); // 0x2000+31 maps to phys 0x001F
    expect((ppu as any).vram[0x0400 + 0]).toBe(2); // 0x2400 maps to phys 0x0400 under vertical mirroring

    // Set scroll coarseX=31, fineX=0 ; coarseY=0, fineY=0
    ppu.cpuWrite(0x2005, 248);
    ppu.cpuWrite(0x2005, 0);
    // Enable bg left and bg
    ppu.cpuWrite(0x2001, 0x0A);

    // Introspect internal addressing for the first pixel
    const t = (ppu as any).t as number;
    const xFine = (ppu as any).x as number;
    const coarseXScroll = (t & 0x1F) << 3;
    const coarseYScroll = ((t >> 5) & 0x1F) << 3;
    const fineYScroll = (t >> 12) & 0x07;
    const worldX = coarseXScroll + (xFine & 7) + 0;
    const worldY = coarseYScroll + fineYScroll + 0;
    expect({ coarseXScroll, xFine }).toEqual({ coarseXScroll: 248, xFine: 0 });
    expect(worldX).toBe(248);
    const coarseX = (worldX >> 3) & 0x1F;
    const coarseY = (worldY >> 3) & 0x1F;
    const baseNtX = (t >> 10) & 1;
    const baseNtY = (t >> 11) & 1;
    expect(baseNtX).toBe(0);
    const ntX = (baseNtX + ((worldX >> 8) & 1)) & 1;
    const ntY = (baseNtY + ((worldY >> 8) & 1)) & 1;
    expect(ntX).toBe(0);
    const ntIndexSel = (ntY << 1) | ntX;
    const ntBase = 0x2000 + (ntIndexSel * 0x400);
    const ntAddr = ntBase + (coarseY * 32 + coarseX);
    const ntPhys = (ppu as any).mapNametable(ntAddr) as number;
    expect(ntPhys).toBe(0x001F);
    const tileIndex = (ppu as any).vram[ntPhys] as number;
    expect(tileIndex).toBe(1);

    const pix = ppu.sampleBgPixel(0, 0);
    expect(pix).toBe(1);

    const color = (ppu as any).sampleBgColor(0, 0) as number;
    expect(color & 0x3F).toBe(1);

    const fb = (ppu as any).renderBgFrame() as Uint8Array;
    expect(fb[0] & 0x3F).toBe(1);
  });
});

