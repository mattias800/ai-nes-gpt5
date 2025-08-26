import type { Byte, Word } from '@core/cpu/types';

// Minimal PPU: registers and VRAM/palette behavior for unit tests, plus basic timing flags.

export type MirrorMode = 'horizontal' | 'vertical' | 'single0' | 'single1' | 'four';

export class PPU {
  // CPU-visible registers
  ctrl = 0; // $2000
  mask = 0; // $2001
  status = 0; // $2002 (VBlank=bit7)
  oamAddr = 0; // $2003

  // Per-dot framebuffer of palette indices (0..63), 256x240
  private framebuffer = new Uint8Array(256 * 240);

  // Internal latches
  private w = 0; // write toggle for $2005/$2006
  private t = 0; // temp VRAM addr (15 bits)
  private v = 0; // current VRAM addr (15 bits)
  private x = 0; // fine X scroll (3 bits)
  private latchedX = 0; // fine X latched at start of visible scanline for vt sampling
  // Shadow scroll values used by sampling (updated only by PPUSCROLL writes)
  private scrollCoarseX = 0; // 0..31
  private scrollCoarseY = 0; // 0..31
  private scrollFineY = 0;   // 0..7

  // Memory
  private vram = new Uint8Array(0x800); // 2KB nametable RAM
  private palette = new Uint8Array(32);
  private oam = new Uint8Array(256);

  // Cartridge CHR hooks
  private chrRead: (addr: Word) => Byte = () => 0x00;
  private chrWrite: (addr: Word, value: Byte) => void = () => {};
  private onA12Rise: (() => void) | null = null;
  private lastA12 = 0; // previous state of A12 during CHR access
  private a12LastLowDot = 0; // last dot when A12 was observed low
  private a12Filter = 8; // minimum dots A12 must stay low before next rising edge counts
  private dot = 0; // monotonically increasing PPU dot counter

  // Read buffer for $2007
  private readBuffer = 0;

  // Timing
  cycle = 0; // 0..340
  scanline = 0; // 0..261
  frame = 0;
  private oddFrame = false; // for odd-frame timing if needed

  // NMI handling
  nmiOccurred = false; // VBlank edge occurred
  nmiOutput = false; // from ctrl bit7

  // Sampling mode: legacy (scroll-shadow) vs vt (loopy v/t timing). Default legacy for compatibility.
  private useVT = false;

  constructor(private mirror: MirrorMode = 'vertical') {
    try {
      // Allow default timing mode via env for tests
      // eslint-disable-next-line no-undef
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      if (env && env.PPU_TIMING_DEFAULT === 'vt') this.useVT = true;
    } catch {}
  }

  setMirroring(mode: MirrorMode) { this.mirror = mode; }

  connectCHR(read: (addr: Word) => Byte, write: (addr: Word, value: Byte) => void) {
    this.chrRead = read; this.chrWrite = write;
  }

  setA12Hook(hook: (() => void) | null) { this.onA12Rise = hook; }
  // Allow tests to switch sampling timing behavior safely
  setTimingMode(mode: 'legacy' | 'vt') { this.useVT = (mode === 'vt'); }

  reset() {
    this.ctrl = 0; this.mask = 0; this.status = 0;
    this.oamAddr = 0; this.w = 0; this.t = 0; this.v = 0; this.x = 0;
    this.readBuffer = 0; this.cycle = 0; this.scanline = 0; this.frame = 0;
    this.nmiOccurred = false; this.nmiOutput = false;
    this.vram.fill(0); this.palette.fill(0); this.oam.fill(0);
    this.framebuffer.fill(0);
    // Scroll shadow reset
    this.scrollCoarseX = 0; this.scrollCoarseY = 0; this.scrollFineY = 0;
    this.latchedX = 0;
    // A12 filter state
    this.lastA12 = 0; this.a12LastLowDot = 0; this.dot = 0;
  }

  // --- CPU interface ---
  cpuRead(addr: Word): Byte {
    addr &= 0x2007; // caller should mirror to 2000-2007
    switch (addr) {
      case 0x2002: { // PPUSTATUS
        const value = (this.status & 0xE0) | (this.readBuffer & 0x1F); // lower 5 bits return stale
        // Clear vblank flag and write toggle
        this.status &= ~0x80;
        this.w = 0;
        this.nmiOccurred = false;
        return value;
      }
      case 0x2004: { // OAMDATA
        return this.oam[this.oamAddr & 0xFF];
      }
      case 0x2007: {
        const addr = this.v & 0x3FFF;
        let value: number;
        if (addr >= 0x3F00 && addr <= 0x3FFF) {
          // Palette reads are not buffered
          value = this.readPalette(addr & 0x1F);
          this.readBuffer = this.ppuRead((addr - 0x1000) & 0x3FFF); // emulate palette mirroring quirk
        } else {
          value = this.readBuffer;
          this.readBuffer = this.ppuRead(addr);
        }
        this.v = (this.v + this.vramIncrement()) & 0x7FFF;
        return value & 0xFF;
      }
      default:
        return 0x00;
    }
  }

  cpuWrite(addr: Word, value: Byte): void {
    addr &= 0x2007;
    value &= 0xFF;
    switch (addr) {
      case 0x2000: { // PPUCTRL
        this.ctrl = value;
        this.t = (this.t & 0xF3FF) | ((value & 0x03) << 10);
        const prev = this.nmiOutput;
        this.nmiOutput = !!(value & 0x80);
        // If NMI becomes enabled during VBlank, trigger NMI edge
        if (!prev && this.nmiOutput && (this.status & 0x80)) {
          this.nmiOccurred = true;
        }
        break;
      }
      case 0x2001: { // PPUMASK
        this.mask = value;
        break;
      }
      case 0x2003: { // OAMADDR
        this.oamAddr = value;
        break;
      }
      case 0x2004: { // OAMDATA
        this.oam[this.oamAddr & 0xFF] = value;
        this.oamAddr = (this.oamAddr + 1) & 0xFF;
        break;
      }
      case 0x2005: { // PPUSCROLL
        if (this.w === 0) {
          this.x = value & 0x07;
          this.t = (this.t & 0x7FE0) | (value >> 3);
          this.scrollCoarseX = (value >> 3) & 0x1F;
          this.w = 1;
        } else {
          this.t = (this.t & 0x0C1F) | ((value & 0x07) << 12) | ((value & 0xF8) << 2);
          this.scrollFineY = value & 0x07;
          this.scrollCoarseY = (value >> 3) & 0x1F;
          this.w = 0;
        }
        break;
      }
      case 0x2006: { // PPUADDR
        if (this.w === 0) {
          this.t = (this.t & 0x00FF) | ((value & 0x3F) << 8);
          this.w = 1;
        } else {
          this.t = (this.t & 0x7F00) | value;
          this.v = this.t;
          this.w = 0;
        }
        break;
      }
      case 0x2007: { // PPUDATA
        const addr = this.v & 0x3FFF;
        this.ppuWrite(addr, value);
        this.v = (this.v + this.vramIncrement()) & 0x7FFF;
        break;
      }
    }
  }

  // --- OAM DMA ---
  oamDMA(readByte: (addr: Word) => Byte, page: Byte) {
    const base = (page << 8) & 0xFF00;
    let addr = this.oamAddr & 0xFF;
    for (let i = 0; i < 256; i++) {
      this.oam[addr] = readByte((base + i) & 0xFFFF) & 0xFF;
      addr = (addr + 1) & 0xFF;
    }
  }

  // Expose OAM byte for testing
  getOAMByte(index: number): Byte {
    return this.oam[index & 0xFF];
  }

  // --- Timing ---
  tick(ppuCycles: number = 1) {
    for (let i = 0; i < ppuCycles; i++) {
      // Advance global dot counter first so filters see current dot
      this.dot++;

      const renderingEnabled = (this.mask & 0x18) !== 0; // bg or sprites
      // Per-dot behavior for scroll increments/copies when rendering
      if (renderingEnabled) {
        if (this.scanline >= 0 && this.scanline <= 239) {
          // Visible scanline
          const x = this.cycle - 1; // pixel x (0..255) at cycles 1..256
          const y = this.scanline;  // pixel y (0..239)

          // Sprite overflow evaluation at start of visible scanline (approximation):
          if (this.cycle === 1) {
            // Latch fine X for vt sampling so mid-scanline $2005 writes don't affect current scanline
            this.latchedX = this.x & 0x07;
            const height16 = (this.ctrl & 0x20) !== 0;
            const spriteHeight = height16 ? 16 : 8;
            let count = 0;
            for (let i = 0; i < 64; i++) {
              const o = i * 4;
              const sy = ((this.oam[(o + 0) & 0xFF] + 1) & 0xFF);
              if (y >= sy && y < (sy + spriteHeight)) {
                count++;
                if (count > 8) { this.status |= 0x20; break; }
              }
            }
          }

          if (this.cycle === 256) this.incY();
          if (this.cycle === 257) this.copyX();
          // Minimal CHR access simulation to drive A12: ensure a low early, then a high later
          if (this.cycle === 1) this.ppuRead(0x0FF8); // A12=0
          if (this.cycle === 260) this.ppuRead(0x1000); // A12=1 -> potential rising edge

          // Minimal sprite 0 hit detection (8x8 sprites only)
          if (x >= 0 && x < 256) {
            const bgEnabled = (this.mask & 0x08) !== 0;
            const spEnabled = (this.mask & 0x10) !== 0;
            if (bgEnabled && spEnabled && (this.status & 0x40) === 0) {
              const showBgLeft = (this.mask & 0x02) !== 0;
              const showSpLeft = (this.mask & 0x04) !== 0;
              const bgVisible = x >= 8 || showBgLeft;
              const spVisible = x >= 8 || showSpLeft;
              if (bgVisible && spVisible) {
                const bgPix = this.useVT ? this.sampleBgPixelV(x, y) : this.sampleBgPixel(x, y);
                const sp0Pix = this.sampleSprite0Pixel(x, y);
                if (bgPix !== 0 && sp0Pix !== 0) {
                  this.status |= 0x40; // sprite 0 hit
                }
              }
            }
            // Per-dot framebuffer write (background + sprites blending)
            if (x >= 0 && x < 256) {
              let outColor = 0;
              const showBgLeft = (this.mask & 0x02) !== 0;
              const bgPixRaw = (this.useVT ? this.sampleBgPixelV(x, y) : this.sampleBgPixel(x, y)) & 0x03;
              const bgMasked = (!showBgLeft && x < 8);
              const bgPixEff = bgMasked ? 0 : bgPixRaw;
              const bgColor = bgPixEff === 0 ? this.readPalette(0x00) : (this.useVT ? this.sampleBgColorV(x, y) : this.sampleBgColor(x, y));

              const showSpLeft = (this.mask & 0x04) !== 0;
              const sp = (showSpLeft || x >= 8) ? this.sampleSpritePixel(x, y) : null;

              outColor = bgColor & 0x3F;
              if (sp && sp.pix !== 0) {
                const spPalIndex = 0x10 + ((sp.pal & 0x03) << 2) + sp.pix;
                const spColor = this.readPalette(spPalIndex) & 0x3F;
                if (bgPixEff === 0 || sp.priority === 0) outColor = spColor;
              }
              this.framebuffer[(y * 256) + x] = outColor;
            }
          }
        } else if (this.scanline === 261) { // pre-render line
          if (this.cycle >= 280 && this.cycle <= 304) this.copyY();
        }
      }

      this.cycle++;
      if (this.cycle > 340) {
        this.cycle = 0;
        this.scanline++;
        if (this.scanline === 241) {
          // Enter VBlank at scanline 241, cycle 1
          this.status |= 0x80;
          if (this.nmiOutput) this.nmiOccurred = true;
        } else if (this.scanline >= 262) {
          // Pre-render line entered
          this.scanline = 0;
          this.frame++;
          // Odd-frame skip: On odd frames with rendering enabled, the PPU skips one cycle at the very start of pre-render
          // We model this minimally: if rendering enabled and oddFrame, consume one extra cycle to advance to cycle 1
          const renderingEnabled = (this.mask & 0x18) !== 0;
          if (renderingEnabled) {
            this.oddFrame = !this.oddFrame;
          } else {
            this.oddFrame = false;
          }
          // clear vblank, sprite 0 hit, and sprite overflow at start of new frame
          this.status &= ~0x80;
          this.status &= ~0x40;
          this.status &= ~0x20;
          this.nmiOccurred = false;
        }
      }
    }
  }

  private incY() {
    // From nesdev loopy v: increment vertical scroll in v
    if ((this.v & 0x7000) !== 0x7000) {
      this.v += 0x1000;
    } else {
      this.v &= ~0x7000;
      let y = (this.v & 0x03E0) >> 5; // coarse Y
      if (y === 29) {
        y = 0;
        this.v ^= 0x0800; // switch vertical nametable
      } else if (y === 31) {
        y = 0;
      } else {
        y++;
      }
      this.v = (this.v & ~0x03E0) | (y << 5);
    }
  }
  private copyX() {
    // v: .....F.. ...EDCBA = t: .....F.. ...EDCBA
    this.v = (this.v & ~0x041F) | (this.t & 0x041F);
  }
  private copyY() {
    // v: .IHGF.ED CBA..... = t: .IHGF.ED CBA.....
    this.v = (this.v & ~0x7BE0) | (this.t & 0x7BE0);
  }

  // --- Internal PPU memory ---
  private vramIncrement(): number { return (this.ctrl & 0x04) ? 32 : 1; }

  private ppuRead(addr14: Word): Byte {
    const a = addr14 & 0x3FFF;
    if (a < 0x2000) {
      // Delegate to cartridge CHR space with A12 rise detection + deglitch filter
      const a12 = (a >> 12) & 1;
      if (a12 === 0) {
        this.a12LastLowDot = this.dot;
      }
      if (this.lastA12 === 0 && a12 === 1) {
        if (this.dot - this.a12LastLowDot >= this.a12Filter) {
          this.onA12Rise && this.onA12Rise();
        }
      }
      this.lastA12 = a12;
      return this.chrRead(a);
    }
    if (a < 0x3F00) {
      const nt = this.mapNametable(a);
      return this.vram[nt];
    }
    return this.readPalette(a & 0x1F);
  }

  private ppuWrite(addr14: Word, value: Byte) {
    const a = addr14 & 0x3FFF;
    value &= 0xFF;
    if (a < 0x2000) {
      // Delegate to CHR RAM/ROM write with A12 rise detection + deglitch filter
      const a12 = (a >> 12) & 1;
      if (a12 === 0) {
        this.a12LastLowDot = this.dot;
      }
      if (this.lastA12 === 0 && a12 === 1) {
        if (this.dot - this.a12LastLowDot >= this.a12Filter) {
          this.onA12Rise && this.onA12Rise();
        }
      }
      this.lastA12 = a12;
      this.chrWrite(a, value);
      return;
    }
    if (a < 0x3F00) {
      const nt = this.mapNametable(a);
      this.vram[nt] = value;
      return;
    }
    this.writePalette(a & 0x1F, value);
  }

  private mapNametable(a: Word): number {
    const vramIndex = (a - 0x2000) & 0x0FFF; // 4KB region
    const table = (vramIndex >> 10) & 0x03; // 0..3
    const offset = vramIndex & 0x03FF;
    let phys: number;
    switch (this.mirror) {
      case 'vertical':
        // tables 0,2 -> nt0; 1,3 -> nt1
        phys = (table & 1) * 0x400 + offset;
        break;
      case 'horizontal':
        // tables 0,1 -> nt0; 2,3 -> nt1
        phys = ((table >> 1) & 1) * 0x400 + offset;
        break;
      case 'single0': phys = 0x000 + offset; break;
      case 'single1': phys = 0x400 + offset; break;
      case 'four': default:
        // Four-screen not modeled; map tables 0,1 to 0x000.., 2,3 wrap
        phys = (table & 1) * 0x400 + offset;
    }
    return phys & 0x7FF;
  }

  private readPalette(i: number): Byte {
    const idx = this.paletteIndexMirror(i & 0x1F);
    return this.palette[idx] & 0x3F; // 6-bit
  }
  private writePalette(i: number, v: Byte) {
    const idx = this.paletteIndexMirror(i & 0x1F);
    this.palette[idx] = v & 0x3F;
  }
  private paletteIndexMirror(i: number): number {
    // Palette mirroring: 0x3F10,14,18,1C mirror 0x3F00,04,08,0C
    if ((i & 0x13) === 0x10) i &= 0x0F;
    return i & 0x1F;
  }

  // --- Minimal pixel sampling for tests ---
  // Frame-render path (offline) uses scroll shadow + PPUCTRL base for compatibility with unit tests
  public sampleBgPixel(x: number, y: number): number {
    const base = (this.ctrl & 0x10) ? 0x1000 : 0x0000;
    const coarseXScroll = (this.scrollCoarseX & 0x1F) << 3;
    const fineYScroll = this.scrollFineY & 0x07;
    const coarseYScroll = (this.scrollCoarseY & 0x1F) << 3;
    const worldX = coarseXScroll + (this.x & 0x07) + x;
    const worldY = coarseYScroll + fineYScroll + y;
    const fineX = worldX & 0x07;
    const fineY = worldY & 0x07;
    const coarseX = (worldX >> 3) & 0x1F;
    const coarseY = (worldY >> 3) & 0x1F;
    const baseNt = this.ctrl & 0x03;
    const baseNtX = baseNt & 1;
    const baseNtY = (baseNt >> 1) & 1;
    const ntX = (baseNtX + ((worldX >> 8) & 1)) & 1;
    const ntY = (baseNtY + ((worldY >> 8) & 1)) & 1;
    const ntIndexSel = (ntY << 1) | ntX;
    const ntBase = 0x2000 + (ntIndexSel * 0x400);
    const ntAddr = ntBase + (coarseY * 32 + coarseX);
    const ntPhys = this.mapNametable(ntAddr);
    const ntIndex = this.vram[ntPhys];
    const tileAddr = (base + (ntIndex << 4) + fineY) & 0x1FFF;
    const lo = this.chrRead(tileAddr);
    const hi = this.chrRead((tileAddr + 8) & 0x1FFF);
    const bit = 7 - fineX;
    const p0 = (lo >> bit) & 1;
    const p1 = (hi >> bit) & 1;
    return ((p1 << 1) | p0) & 0x03;
  }
  private sampleBgColor(x: number, y: number): number {
    const pix = this.sampleBgPixel(x, y) & 0x03;
    if (pix === 0) return this.readPalette(0x00);
    const coarseXScroll = (this.scrollCoarseX & 0x1F) << 3;
    const fineYScroll = this.scrollFineY & 0x07;
    const coarseYScroll = (this.scrollCoarseY & 0x1F) << 3;
    const worldX = coarseXScroll + (this.x & 0x07) + x;
    const worldY = coarseYScroll + fineYScroll + y;
    const coarseX = (worldX >> 3) & 0x1F;
    const coarseY = (worldY >> 3) & 0x1F;
    const baseNt = this.ctrl & 0x03;
    const baseNtX = baseNt & 1;
    const baseNtY = (baseNt >> 1) & 1;
    const ntX = (baseNtX + ((worldX >> 8) & 1)) & 1;
    const ntY = (baseNtY + ((worldY >> 8) & 1)) & 1;
    const ntBase = 0x2000 + (((ntY << 1) | ntX) * 0x400);
    const attAddr = ntBase + 0x3C0 + ((coarseY >> 2) * 8) + (coarseX >> 2);
    const attIndex = this.mapNametable(attAddr);
    const att = this.vram[attIndex];
    const shift = ((coarseY & 0x02) << 1) | (coarseX & 0x02);
    const pal = (att >> shift) & 0x03;
    return this.readPalette(0x00 + (pal << 2) + pix);
  }

  // V-based sampling used during per-dot rendering (tick)
  private sampleBgPixelV(x: number, y: number): number {
    const base = (this.ctrl & 0x10) ? 0x1000 : 0x0000;
    const fineXScroll = this.latchedX & 0x07;
    const coarseXBase = this.v & 0x1F;
    const coarseYBase = (this.v >> 5) & 0x1F;
    const ntXBase = (this.v >> 10) & 0x01;
    const ntYBase = (this.v >> 11) & 0x01;
    const fineYBase = (this.v >> 12) & 0x07;
    const tileAdv = ((x + fineXScroll) >> 3) & 0x3F;
    const fineX = (x + fineXScroll) & 0x07;
    const coarseX = (coarseXBase + tileAdv) & 0x1F;
    const ntX = (ntXBase + ((coarseXBase + tileAdv) >> 5)) & 0x01;
    const fineY = fineYBase & 0x07;
    const coarseY = coarseYBase & 0x1F;
    const ntY = ntYBase & 0x01;
    const ntIndexSel = (ntY << 1) | ntX;
    const ntBase = 0x2000 + (ntIndexSel * 0x400);
    const ntAddr = ntBase + (coarseY * 32 + coarseX);
    const ntPhys = this.mapNametable(ntAddr);
    const ntIndex = this.vram[ntPhys];
    const tileAddr = (base + (ntIndex << 4) + fineY) & 0x1FFF;
    const lo = this.chrRead(tileAddr);
    const hi = this.chrRead((tileAddr + 8) & 0x1FFF);
    const bit = 7 - fineX;
    const p0 = (lo >> bit) & 1;
    const p1 = (hi >> bit) & 1;
    return ((p1 << 1) | p0) & 0x03;
  }
  private sampleBgColorV(x: number, y: number): number {
    const pix = this.sampleBgPixelV(x, y) & 0x03;
    if (pix === 0) return this.readPalette(0x00);
    const fineXScroll = this.x & 0x07;
    const coarseXBase = this.v & 0x1F;
    const coarseYBase = (this.v >> 5) & 0x1F;
    const ntXBase = (this.v >> 10) & 0x01;
    const ntYBase = (this.v >> 11) & 0x01;
    const tileAdv = ((x + fineXScroll) >> 3) & 0x3F;
    const coarseX = (coarseXBase + tileAdv) & 0x1F;
    const coarseY = coarseYBase & 0x1F;
    const ntX = (ntXBase + ((coarseXBase + tileAdv) >> 5)) & 0x01;
    const ntY = ntYBase & 0x01;
    const ntBase = 0x2000 + (((ntY << 1) | ntX) * 0x400);
    const attAddr = ntBase + 0x3C0 + ((coarseY >> 2) * 8) + (coarseX >> 2);
    const attIndex = this.mapNametable(attAddr);
    const att = this.vram[attIndex];
    const shift = ((coarseY & 0x02) << 1) | (coarseX & 0x02);
    const pal = (att >> shift) & 0x03;
    return this.readPalette(0x00 + (pal << 2) + pix);
  }


  private sampleSprite0Pixel(x: number, y: number): number {
    // Only 8x8 sprites considered. OAM[0..3] = Y, tile, attr, X
    const sy = (this.oam[0] + 1) & 0xFF;
    const tile = this.oam[1] & 0xFF;
    const attr = this.oam[2] & 0xFF;
    const sx = this.oam[3] & 0xFF;
    const height16 = (this.ctrl & 0x20) !== 0;
    if (height16) return 0; // not supported in minimal sampler

    if (x < sx || x >= sx + 8 || y < sy || y >= sy + 8) return 0;
    // Sprite pattern table base from PPUCTRL bit 3
    const base = (this.ctrl & 0x08) ? 0x1000 : 0x0000;

    const flipH = (attr & 0x40) !== 0;
    const flipV = (attr & 0x80) !== 0;

    let fx = (x - sx) & 0x07;
    let fy = (y - sy) & 0x07;
    if (flipH) fx = 7 - fx;
    if (flipV) fy = 7 - fy;

    const tileAddr = (base + (tile << 4) + fy) & 0x1FFF;
    const lo = this.chrRead(tileAddr);
    const hi = this.chrRead((tileAddr + 8) & 0x1FFF);
    const bit = 7 - fx;
    const p0 = (lo >> bit) & 1;
    const p1 = (hi >> bit) & 1;
    return (p1 << 1) | p0;
  }

  // Render a background-only framebuffer (256x240) of 2-bit pixel indices.
  public renderBgFrame(): Uint8Array {
    const w = 256, h = 240;
    const buf = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        // Left-edge background mask (PPUMASK bit1). If clear and x<8, hide bg
        const showBgLeft = (this.mask & 0x02) !== 0;
        const color = (!showBgLeft && x < 8) ? this.readPalette(0x00) : this.sampleBgColor(x, y);
        buf[row + x] = color & 0x3F;
      }
    }
    return buf;
  }

  private sampleSpritePixel(x: number, y: number): { pix: number, priority: number, pal: number } | null {
    // Only 8x8 sprites supported in this minimal renderer
    const spriteHeight16 = (this.ctrl & 0x20) !== 0;
    if (spriteHeight16) return null;
    const base = (this.ctrl & 0x08) ? 0x1000 : 0x0000;

    let result: { pix: number, priority: number, pal: number } | null = null;
    // Iterate OAM sprites; lower index has higher priority. Iterate descending so lower index wins last.
    for (let i = 63; i >= 0; i--) {
      const o = i * 4;
      const sy = ((this.oam[(o + 0) & 0xFF] + 1) & 0xFF);
      const tile = this.oam[(o + 1) & 0xFF] & 0xFF;
      const attr = this.oam[(o + 2) & 0xFF] & 0xFF;
      const sx = this.oam[(o + 3) & 0xFF] & 0xFF;

      if (x < sx || x >= sx + 8 || y < sy || y >= sy + 8) continue;

      let fx = (x - sx) & 0x07;
      let fy = (y - sy) & 0x07;
      if ((attr & 0x40) !== 0) fx = 7 - fx; // H flip
      if ((attr & 0x80) !== 0) fy = 7 - fy; // V flip

      const tileAddr = (base + (tile << 4) + fy) & 0x1FFF;
      const lo = this.chrRead(tileAddr);
      const hi = this.chrRead((tileAddr + 8) & 0x1FFF);
      const bit = 7 - fx;
      const p0 = (lo >> bit) & 1;
      const p1 = (hi >> bit) & 1;
      const pix = ((p1 << 1) | p0) & 0x03;
      if (pix !== 0) {
        const priority = (attr & 0x20) ? 1 : 0; // 1=behind background, 0=in front
        const pal = attr & 0x03; // sprite palette 0..3
        result = { pix, priority, pal };
        // continue to allow lower index to override (since we iterate descending)
      }
    }
    return result;
  }

  // Expose the latest per-dot framebuffer (palette indices)
  public getFrameBuffer(): Uint8Array {
    return this.framebuffer;
  }

  // Render a full framebuffer (background + sprites) of 2-bit pixel indices (no palette).
  public renderFrame(): Uint8Array {
    const w = 256, h = 240;
    const buf = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        // Background color, with left-edge mask
        const showBgLeft = (this.mask & 0x02) !== 0;
        const bgPixRaw = (this.useVT ? this.sampleBgPixelV(x, y) : this.sampleBgPixel(x, y)) & 0x03;
        const bgMasked = (!showBgLeft && x < 8);
        const bgPixEff = bgMasked ? 0 : bgPixRaw;
        const bgColor = bgPixEff === 0 ? this.readPalette(0x00) : (this.useVT ? this.sampleBgColorV(x, y) : this.sampleBgColor(x, y));

        // Sprite sampling
        const showSpLeft = (this.mask & 0x04) !== 0;
        const sp = (showSpLeft || x >= 8) ? this.sampleSpritePixel(x, y) : null;

        let outColor = bgColor & 0x3F;
        if (sp && sp.pix !== 0) {
          // Sprite palette base 0x10; per-sprite palette from attr low 2 bits
          const spPalIndex = 0x10 + ((sp.pal & 0x03) << 2) + sp.pix;
          const spColor = this.readPalette(spPalIndex) & 0x3F;
          if (bgPixEff === 0 || sp.priority === 0) outColor = spColor;
        }
        buf[row + x] = outColor;
      }
    }
    return buf;
  }
}
