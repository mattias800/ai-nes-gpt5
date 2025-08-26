import { describe, it, expect } from 'vitest'
import { PPU } from '@core/ppu/ppu'
import { MMC3 } from '@core/cart/mappers/mmc3'

function writeAddr(ppu: PPU, addr: number) {
  ppu.cpuWrite(0x2006, (addr >> 8) & 0xFF)
  ppu.cpuWrite(0x2006, addr & 0xFF)
}
function writePPU(ppu: PPU, addr: number, val: number) {
  writeAddr(ppu, addr)
  ppu.cpuWrite(0x2007, val & 0xFF)
}

// Deterministic mid-frame CHR bank switch without CPU/IRQ: drive PPU ticks and switch MMC3 R2 during a visible frame

describe('MMC3 CHR bankswitch mid-frame affects subsequent lines (VT)', () => {
  it('switching R2 during visible rendering changes BG pattern at lower rows', () => {
    const ppu = new PPU('vertical');
    ppu.reset();
    ppu.setTimingMode('vt');

    // MMC3 with 8KB CHR RAM; prefill patterns and connect to PPU
    const prg = new Uint8Array(16 * 0x4000); // unused here
    const chr = new Uint8Array(0x2000);
    // Bank0 mapping for R2: indices 0x0000..: lo plane 0xFF, hi plane 0x00
    for (let y = 0; y < 8; y++) chr[0x0000 + (0<<4) + y] = 0xFF; // lo plane
    for (let y = 0; y < 8; y++) chr[0x0000 + (0<<4) + 8 + y] = 0x00; // hi plane
    // Bank4 mapping for R2: base = 4*1KB = 0x1000
    for (let y = 0; y < 8; y++) chr[0x1000 + (0<<4) + y] = 0x00; // lo plane
    for (let y = 0; y < 8; y++) chr[0x1000 + (0<<4) + 8 + y] = 0xFF; // hi plane
    const mmc3 = new MMC3(prg, chr);
    ppu.connectCHR((a) => mmc3.ppuRead(a), (a, v) => mmc3.ppuWrite(a, v));

    // Use BG pattern table at $1000
    ppu.cpuWrite(0x2000, 0x10);

    // Palette identity: 1->0x05, 2->0x06
    writePPU(ppu, 0x3F00, 0x00); writePPU(ppu, 0x3F01, 0x05); writePPU(ppu, 0x3F02, 0x06); writePPU(ppu, 0x3F03, 0x07);

    // Fill NT0 column 0 with tile 0 across rows
    for (let row = 0; row < 30; row++) writePPU(ppu, 0x2000 + row*32 + 0, 0);

    // Show BG and left 8
    ppu.cpuWrite(0x2001, 0x0A);

    // Initialize R2 = 0 (bank 0)
    mmc3.cpuWrite(0x8000, 0x02); // select R2
    mmc3.cpuWrite(0x8001, 0x00); // bank 0

    // Render some lines (e.g., 20 visible lines)
    for (let sl = 0; sl < 20; sl++) ppu.tick(341);

    // Sample a color before switch
    let fb = (ppu as any).getFrameBuffer() as Uint8Array;
    const topColor = fb[0] & 0x3F;
    expect([0x00, 0x05]).toContain(topColor); // allow universal on earliest top

    // Switch R2 to bank 4 mid-frame
    mmc3.cpuWrite(0x8000, 0x02);
    mmc3.cpuWrite(0x8001, 0x04);

    // Render more lines (e.g., 30 more visible lines)
    for (let sl = 0; sl < 30; sl++) ppu.tick(341);

    fb = (ppu as any).getFrameBuffer() as Uint8Array;
    const w = 256;
    const bottomColor = fb[40*w + 0] & 0x3F;
    expect(bottomColor).toBe(0x06);
  });
});

