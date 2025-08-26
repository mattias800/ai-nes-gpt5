import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';

// Deterministic sprite 0 hit timing test
// We construct:
// - CHR with tile #1 having a non-zero pixel at (0,0) only (lo bit=1, hi=0)
// - Nametable 0 filled with tile #1 so background pixel at (x=10,y=20) is non-zero
// - Sprite 0 placed at (x=10,y=20) with tile #1
// Enable background and sprite rendering with left-edge masking enabled.
// Expect sprite 0 hit (status bit 6) to be set during the visible scanline when x reaches 10.

describe('PPU sprite 0 hit timing (minimal)', () => {
  it('sets sprite 0 hit when bg and sprite non-zero at same pixel respecting left-edge masking', () => {
    const ppu = new PPU();
    ppu.reset();

    // Configure PPUCTRL so background uses pattern table at 0x0000 and sprites at 0x0000 as well
    // Also ensure 8x8 sprites (bit 5 = 0)
    ppu.cpuWrite(0x2000, 0x00);

    // Enable background and sprite rendering and allow left 8 pixels for both
    // PPUMASK: bit3=bg, bit4=sprite, bit1=show bg left, bit2=show sprite left
    ppu.cpuWrite(0x2001, 0x1E); // 0001 1110 -> grayscale off, bg left on, sp left on, bg on, sp on

    // Build CHR tile #1: set bit 7 of lo plane for scanline 0 -> pixel x=0 non-zero; keep others zero
    // We'll align both bg and sprite so the non-zero pixel overlaps at screen x=10,y=20 where fineX=0
    // lo plane at 0x0000 + tile*16 + fineY; hi plane = +8
    // Set only fineY=0 row, bit7=1 -> first column non-zero
    // We want the overlap where fineX=0 inside the tile; by placing coarseX such that x%8==0 at x=10 (not possible),
    // we'll instead choose x=16 (aligned) for determinism. So place at x=16,y=24.

    // Adjust plan: use x=16,y=24 to ensure fineX=0 and fineY=0.
    // Update mask expectation accordingly.

    // Write tile #1 pattern: only row 0 has bit7=1 in low plane
    // CHR write via internal path: we can call ppu['chrWrite'] indirectly with cpuWrite to $2006/$2007 isn't available; instead
    // use the public connectCHR path with a simple CHR RAM backing to allow direct writes via the mapper hooks.

    // Provide a CHR RAM backing
    const chr = new Uint8Array(0x2000);
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });

    // Tile #1 base
    const tileBase = 1 << 4; // 16 bytes per tile
    chr[tileBase + 0] = 0x80; // lo plane row 0: 1000 0000 -> bit7 set
    chr[tileBase + 8] = 0x00; // hi plane row 0: 0000 0000

    // Fill nametable 0 with tile #1 at coarseX=2, coarseY=3 -> pixel at x=16..23, y=24..31 uses this tile
    // Write via direct vram access (internal). We cannot write VRAM from outside, but tests are allowed to poke internals minimally via $2006/$2007.
    // We'll write to PPUADDR 0x2000 + index and then PPUDATA to set tile index.
    function ppuWriteAddr(ppu: PPU, addr: number, val: number) {
      ppu.cpuWrite(0x2006, (addr >> 8) & 0xFF);
      ppu.cpuWrite(0x2006, addr & 0xFF);
      ppu.cpuWrite(0x2007, val & 0xFF);
    }

    // Compute nametable address for coarseX=2, coarseY=3
    const ntAddr = 0x2000 + (3 * 32 + 2);
    ppuWriteAddr(ppu, ntAddr, 1); // tile index 1

    // Set sprite 0: Y, tile, attr, X. Place at y=24, x=16, tile=1, no flips
    // Write OAM via $2003/$2004
    ppu.cpuWrite(0x2003, 0x00);
    ppu.cpuWrite(0x2004, 23); // Y (OAM Y is top-1 on NES)
    ppu.cpuWrite(0x2004, 1);  // tile
    ppu.cpuWrite(0x2004, 0);  // attr
    ppu.cpuWrite(0x2004, 16); // X

    // Advance PPU to the target scanline with some margin
    // Tick until scanline 24 starts: 24 scanlines * 341 dots
    ppu.tick(24 * 341);

    // Now tick until pixel x=16 occurs -> x = cycle-1, so cycle=17; need 18 ticks from cycle 0
    ppu.tick(18);

    // At this point, sprite 0 hit should be set because bg and sprite pixel are both non-zero at (16,24)
    const status1 = ppu.cpuRead(0x2002);
    expect((status1 & 0x40) !== 0).toBe(true);

    // Verify left-edge masking behavior: if we disable bg left (bit1=0) and place x in left 8, hit should not occur
    // Reset and configure again
    ppu.reset();
    ppu.cpuWrite(0x2000, 0x00);
    // Disable left 8 for bg but keep sprites on left so sprite pixel is visible but bg is masked in left 8
    ppu.cpuWrite(0x2001, 0x1C); // 0001 1100 -> bg left off, sp left on, bg on, sp on
    // Reconnect CHR RAM and reinitialize tile
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });
    // Write nametable tile at coarseX=1 (x range 8..15), coarseY=3 (y 24..31)
    const ntAddr2 = 0x2000 + (3 * 32 + 1);
    ppuWriteAddr(ppu, ntAddr2, 1);
    // Sprite 0 at x=8, y=24
    ppu.cpuWrite(0x2003, 0x00);
    ppu.cpuWrite(0x2004, 23);
    ppu.cpuWrite(0x2004, 1);
    ppu.cpuWrite(0x2004, 0);
    ppu.cpuWrite(0x2004, 8);

    // Advance to scanline 24
    ppu.tick(24 * 341);
    // Tick to cycle for x=8 -> x=cycle-1 => cycle=9; need 10 ticks from cycle 0
    ppu.tick(10);
    const status2 = ppu.cpuRead(0x2002);
    // Background left-edge disabled should prevent hit at x<8, but x=8 is just outside left 8 region; to test masking, move to x=7 instead
    expect((status2 & 0x40) !== 0).toBe(true);

    // More precise left-edge check at x=7 (within left 8): should not hit when bg left is off
    ppu.reset();
    ppu.cpuWrite(0x2000, 0x00);
    ppu.cpuWrite(0x2001, 0x1C); // bg left off
    ppu.connectCHR((a) => chr[a & 0x1FFF], (a, v) => { chr[a & 0x1FFF] = v & 0xFF; });
    const ntAddr3 = 0x2000 + (3 * 32 + 0); // coarseX=0 -> x=0..7
    ppuWriteAddr(ppu, ntAddr3, 1);
    ppu.cpuWrite(0x2003, 0x00);
    ppu.cpuWrite(0x2004, 24);
    ppu.cpuWrite(0x2004, 1);
    ppu.cpuWrite(0x2004, 0);
    ppu.cpuWrite(0x2004, 0);
    ppu.tick(24 * 341);
    // Tick to x=7 -> x=cycle-1 => cycle=8; need 9 ticks from cycle 0
    ppu.tick(9);
    const status3 = ppu.cpuRead(0x2002);
    expect((status3 & 0x40) !== 0).toBe(false);
  });
});

