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
function connectChr(ppu: PPU, chr: Uint8Array) {
  ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });
}

// Verify sprite vs background mixing with masks and priority

describe('PPU sprite/background mixing with masks and priority', () => {
  it('x<8: bg left mask off, sprite left mask on -> sprite color visible', () => {
    const ppu = new PPU(); ppu.reset(); ppu.setTimingMode('vt');

    // CHR: bg tile 1 lo plane non-zero; sprite tile 1 lo plane non-zero
    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) chr[(1<<4)+y] = 0xFF; // lo plane
    connectChr(ppu, chr);

    // Palette: BG palette index for pix!=0 -> 0x05; SPR palette -> 0x22
    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x05); // bg pix1
    writePPU(ppu, 0x3F10, 0x00);
    writePPU(ppu, 0x3F11, 0x22); // spr pix1

    // BG tile at top-left
    writePPU(ppu, 0x2000 + 0, 1);

    // Sprite at x=3 (<8), y=0, in front (priority=0)
    ppu.cpuWrite(0x2003, 0x00);
    ppu.cpuWrite(0x2004, 0xFF);
    ppu.cpuWrite(0x2004, 0x01);
    ppu.cpuWrite(0x2004, 0x00);
    ppu.cpuWrite(0x2004, 0x03);

    // Mask: bg left off (bit1=0), spr left on (bit2=1); both enabled
    ppu.cpuWrite(0x2001, 0x14); // 0001 0100

    // Render first scanline
    ppu.tick(341);
    const fb = (ppu as any).getFrameBuffer() as Uint8Array;
    const color = fb[3];
    expect(color & 0x3F).toBe(0x22);
  });

  it('x>=8: bg non-zero and sprite priority behind -> background wins', () => {
    const ppu = new PPU(); ppu.reset(); ppu.setTimingMode('vt');

    const chr = new Uint8Array(0x2000);
    for (let y = 0; y < 8; y++) chr[(1<<4)+y] = 0xFF;
    connectChr(ppu, chr);

    writePPU(ppu, 0x3F00, 0x00);
    writePPU(ppu, 0x3F01, 0x06); // bg pix1 -> 0x06
    writePPU(ppu, 0x3F10, 0x00);
    writePPU(ppu, 0x3F11, 0x25); // spr pix1 -> 0x25

    writePPU(ppu, 0x2000 + 0, 1);
    writePPU(ppu, 0x2000 + 1, 1);

    // Mask: show left for both so bg non-zero applies at x>=8
    ppu.cpuWrite(0x2001, 0x1E);

    // Reset v/t so vt sampling is not biased by previous VRAM writes
    writeAddr(ppu, 0x0000);

    // Baseline without sprite
    let fb = (ppu as any).renderFrame() as Uint8Array;
    const bgColor = fb[12] & 0x3F;

    // Sprite at x=12, priority behind (bit5)
    ppu.cpuWrite(0x2003, 0x00);
    ppu.cpuWrite(0x2004, 0xFF);
    ppu.cpuWrite(0x2004, 0x01);
    ppu.cpuWrite(0x2004, 0x20); // behind
    ppu.cpuWrite(0x2004, 0x0C);

    // Reset v/t again before offline frame sampling
    writeAddr(ppu, 0x0000);

    fb = (ppu as any).renderFrame() as Uint8Array;
    const mixedColor = fb[12] & 0x3F;
    expect(mixedColor).toBe(bgColor);
  });
});

