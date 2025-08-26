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

describe('Debug sprite0 pixel sampling', () => {
  it('bg and sprite pixels at (16,24) are both non-zero with the given setup', () => {
    const ppu = new PPU();
    ppu.reset();

    // Connect CHR RAM and set tile #1 with lo row 0 bit7=1
    const chr = new Uint8Array(0x2000);
    const tileBase = 1 << 4;
    chr[tileBase + 0] = 0x80; // lo plane row 0
    chr[tileBase + 8] = 0x00; // hi plane row 0
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    // Fill NT0 at coarseX=2, coarseY=3 with tile #1
    const targetIndex = (3 * 32 + 2);
    const targetAddr = 0x2000 + targetIndex;
    writePPU(ppu, targetAddr, 1);
    // Sanity: direct nametable physical check (vertical mirroring default)
    expect((ppu as any).vram[targetIndex]).toBe(1);

    // Set sprite 0 at x=16, y=24 (OAM Y stores top-1)
    ppu.cpuWrite(0x2003, 0);
    ppu.cpuWrite(0x2004, 23); // Y
    ppu.cpuWrite(0x2004, 1);  // tile
    ppu.cpuWrite(0x2004, 0);  // attr
    ppu.cpuWrite(0x2004, 16); // X

    // No scroll; mask enabling bg/sprites
    ppu.cpuWrite(0x2001, 0x1E);

    // Recompute expected bg addressing
    const xFine = (ppu as any).x as number;
    const scx = (ppu as any).scrollCoarseX as number;
    const scy = (ppu as any).scrollCoarseY as number;
    const sfy = (ppu as any).scrollFineY as number;
    expect(scx).toBe(0);
    expect(scy).toBe(0);
    expect(sfy).toBe(0);
    const coarseXScroll = (scx & 0x1F) << 3;
    const fineYScroll = sfy & 0x07;
    const coarseYScroll = (scy & 0x1F) << 3;
    const worldX = coarseXScroll + (xFine & 7) + 16;
    const worldY = coarseYScroll + fineYScroll + 24;
    expect(worldX).toBe(16);
    expect(worldY & 7).toBe(0);
    const coarseX = (worldX >> 3) & 0x1F;
    const coarseY = (worldY >> 3) & 0x1F;
    expect(coarseX).toBe(2);
    expect(coarseY).toBe(3);
    const baseNt = (ppu as any).ctrl & 0x03;
    const baseNtX = baseNt & 1;
    const baseNtY = (baseNt >> 1) & 1;
    const ntX = (baseNtX + ((worldX >> 8) & 1)) & 1;
    const ntY = (baseNtY + ((worldY >> 8) & 1)) & 1;
    const ntIndexSel = (ntY << 1) | ntX;
    const ntBase = 0x2000 + ntIndexSel * 0x400;
    const ntAddr = ntBase + (coarseY * 32 + coarseX);
    const ntPhys = (ppu as any).mapNametable(ntAddr) as number;
    expect(ntPhys).toBe(targetIndex);
    expect((ppu as any).vram[ntPhys]).toBe(1);

    const bg = ppu.sampleBgPixel(16, 24);
    const sp = (ppu as any).sampleSprite0Pixel(16, 24) as number;
    expect(bg).toBe(1);
    expect(sp).toBe(1);
  });
});

