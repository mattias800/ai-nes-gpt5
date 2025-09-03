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
  private ctrlLine = 0; // snapshot of PPUCTRL at cycle 1 of each scanline for phase selection
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
  private a12DetectOverride = false; // allow detection during synthetic pulses even with rendering on
  // Per-visible-scanline pulse state
  private linePulseDone = false;

  // Phase telemetry: capture s0 cycle-1 snapshot, and whether we emitted pulses at c260/c324
  private phaseTrace: Array<{ frame: number, scanline: number, cycle: number, ctrl: number, mask: number, emitted?: boolean }> = [];

  // Telemetry (opt-in via env PPU_TRACE=1): record recent A12 rises with timestamp
  private traceA12: { frame: number, scanline: number, cycle: number }[] = [];
  private traceEnabled = false;
  private ctrlTrace: { frame: number, scanline: number, cycle: number, ctrl: number }[] = [];
  private maskTrace: { frame: number, scanline: number, cycle: number, mask: number }[] = [];

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
  // Offline renderFrame VT usage is opt-in via setTimingMode; env default does not flip this.
  private offlineUseVT = false;

  constructor(private mirror: MirrorMode = 'vertical') {
    try {
      // Allow default timing mode via env for tests
      // eslint-disable-next-line no-undef
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      if (env && env.PPU_TIMING_DEFAULT === 'vt') this.useVT = true;
      if (env && env.PPU_TRACE === '1') this.traceEnabled = true;
    } catch {}
  }

  setMirroring(mode: MirrorMode) { this.mirror = mode; }

  connectCHR(read: (addr: Word) => Byte, write: (addr: Word, value: Byte) => void) {
    this.chrRead = read; this.chrWrite = write;
  }

  setA12Hook(hook: (() => void) | null) { this.onA12Rise = hook; }
  // Expose recent A12 rises for tests when tracing is enabled
  getA12Trace(): ReadonlyArray<{ frame: number, scanline: number, cycle: number }> { return this.traceA12; }
  getCtrlTrace(): ReadonlyArray<{ frame: number, scanline: number, cycle: number, ctrl: number }> { return this.ctrlTrace; }
  getMaskTrace(): ReadonlyArray<{ frame: number, scanline: number, cycle: number, mask: number }> { return this.maskTrace; }
  // Expose per-line ctrl snapshot for mapper telemetry
  getCtrlLine(): number { return this.ctrlLine & 0xFF; }
  // Expose phase telemetry for diagnostics
  getPhaseTrace(): ReadonlyArray<{ frame: number, scanline: number, cycle: number, ctrl: number, mask: number, emitted?: boolean }> { return this.phaseTrace; }
  // Allow tests to switch sampling timing behavior safely
  setTimingMode(mode: 'legacy' | 'vt') { 
    const vt = (mode === 'vt');
    this.useVT = vt;         // affects per-dot timing (tick)
    this.offlineUseVT = vt;  // opt-in VT sampling for offline renderFrame
  }

  reset() {
    this.ctrl = 0; this.mask = 0; this.status = 0;
    this.oamAddr = 0; this.w = 0; this.t = 0; this.v = 0; this.x = 0;
    this.readBuffer = 0; this.cycle = 0; this.scanline = 0; this.frame = 0;
    this.ctrlTrace.length = 0;
    this.maskTrace.length = 0;
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
        // Apply A12 deglitch filter even for CPU-driven CHR reads
        this.detectA12FromAddr(addr);
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
        if (this.traceEnabled) {
          if (this.ctrlTrace.length > 1024) this.ctrlTrace.shift();
          this.ctrlTrace.push({ frame: this.frame, scanline: this.scanline, cycle: this.cycle, ctrl: this.ctrl });
        }
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
        if (this.traceEnabled) {
          if (this.maskTrace.length > 1024) this.maskTrace.shift();
          this.maskTrace.push({ frame: this.frame, scanline: this.scanline, cycle: this.cycle, mask: this.mask });
        }
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
          // Evaluate A12 transition with deglitch from the updated VRAM address
          this.detectA12FromAddr(this.v & 0x3FFF);
          this.w = 0;
        }
        break;
      }
      case 0x2007: { // PPUDATA
        const addr = this.v & 0x3FFF;
        // Apply A12 deglitch filter for CPU-driven CHR writes
        this.detectA12FromAddr(addr);
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

      // Odd-frame cycle skip at pre-render line (VT timing only):
      // On odd frames with rendering enabled, the PPU skips cycle 0 of the pre-render line.
      if (this.useVT && renderingEnabled && this.scanline === 261 && this.cycle === 0 && this.oddFrame) {
        // Skip work for cycle 0 by advancing to cycle 1
        this.cycle = 1;
      }

      // Per-dot behavior for scroll increments/copies when rendering
      if (renderingEnabled) {
        if (this.scanline >= 0 && this.scanline <= 239) {
          // Visible scanline
          const x = this.cycle - 1; // pixel x (0..255) at cycles 1..256
          const y = this.scanline;  // pixel y (0..239)

          // Sprite overflow evaluation at start of visible scanline (approximation):
          if (this.cycle === 1) {
            // Reset per-line pulse state and latch fine X for vt sampling
            this.linePulseDone = false;
            this.latchedX = this.x & 0x07;
            // Snapshot PPUCTRL at the start of the line (for telemetry only)
            this.ctrlLine = this.ctrl & 0xFF;
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
          // Minimal CHR access simulation to drive A12 based on pattern table selection
          // Ensure a low early each scanline
          if (this.cycle === 1) { this.a12DetectOverride = true; this.ppuRead(0x0FF8); this.a12DetectOverride = false; }
          // Record s0 c1 snapshot for diagnostics
          if (this.traceEnabled && this.scanline === 0 && this.cycle === 1) {
            if (this.phaseTrace.length > 256) this.phaseTrace.shift();
            this.phaseTrace.push({ frame: this.frame, scanline: this.scanline, cycle: this.cycle, ctrl: this.ctrl & 0xFF, mask: this.mask & 0xFF });
          }
          const bgOn = (this.mask & 0x08) !== 0;
          const spOn = (this.mask & 0x10) !== 0;
          // Sprite-driven pulse at ~260 if sprites@$1000 is currently selected AND sprite rendering is enabled
          if (this.cycle === 260) {
            // Evaluate against live PPUCTRL at the moment of the sprite fetch phase
            const emit = spOn && ((this.ctrl & 0x08) !== 0);
            if (this.traceEnabled && this.scanline === 0) {
              if (this.phaseTrace.length > 256) this.phaseTrace.shift();
              this.phaseTrace.push({ frame: this.frame, scanline: this.scanline, cycle: this.cycle, ctrl: this.ctrl & 0xFF, mask: this.mask & 0xFF, emitted: emit });
            }
            if (emit) {
              this.a12DetectOverride = true; this.ppuRead(0x1000); this.a12DetectOverride = false;
              this.linePulseDone = true;
            } else {
              // maintain low
              this.a12DetectOverride = true; this.ppuRead(0x0FF8); this.a12DetectOverride = false;
            }
          }
          // BG-driven pulse at ~324 if background@$1000 currently selected AND background rendering is enabled,
          // and no sprite-phase pulse was emitted earlier in this line
          if (this.cycle === 324) {
            // Emit background-driven pulse when BG rendering is enabled and no earlier sprite pulse this line
            const emit = (!this.linePulseDone && bgOn);
            if (this.traceEnabled && this.scanline === 0) {
              if (this.phaseTrace.length > 256) this.phaseTrace.shift();
              this.phaseTrace.push({ frame: this.frame, scanline: this.scanline, cycle: this.cycle, ctrl: this.ctrl & 0xFF, mask: this.mask & 0xFF, emitted: emit });
            }
            if (emit) {
              this.a12DetectOverride = true; this.ppuRead(0x1000); this.a12DetectOverride = false;
              this.linePulseDone = true;
            } else {
              // maintain low
              this.a12DetectOverride = true; this.ppuRead(0x0FF8); this.a12DetectOverride = false;
            }
          }

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
                // Prefer VT sampling; fall back to legacy if VT yields zero to reduce false negatives in minimal setups
                const bgPixV = this.sampleBgPixelV(x, y);
                const bgPixL = this.sampleBgPixel(x, y);
                const bgPix = (this.useVT ? (bgPixV || bgPixL) : bgPixL);
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
          // Emit background prefetch A12 at ~324 only (sprites are not fetched on pre-render)
          if (this.cycle === 1) { this.ppuRead(0x0FF8); this.ctrlLine = this.ctrl & 0xFF; } // ensure A12 low
          const bgUses1000 = (this.ctrl & 0x10) !== 0;
          const bgOn = (this.mask & 0x08) !== 0;
          if (this.cycle === 324) {
            // On pre-render, emit one background pulse if BG rendering is enabled
            if (bgOn) {
              this.a12DetectOverride = true; this.ppuRead(0x1000); this.a12DetectOverride = false;
            } else {
              this.a12DetectOverride = true; this.ppuRead(0x0FF8); this.a12DetectOverride = false;
            }
          }
          // Vertical bits copy only occurs when rendering is enabled
          if (renderingEnabled && this.cycle >= 280 && this.cycle <= 304) this.copyY();
          // Vertical bits copy only occurs when rendering is enabled
          if (renderingEnabled && this.cycle >= 280 && this.cycle <= 304) this.copyY();
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
      const renderingEnabled = (this.mask & 0x18) !== 0;
      if (!renderingEnabled || this.a12DetectOverride) {
        this.detectA12FromAddr(a);
      }
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
      const renderingEnabled = (this.mask & 0x18) !== 0;
      if (!renderingEnabled || this.a12DetectOverride) {
        this.detectA12FromAddr(a);
      }
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

  // Evaluate an A12 transition based on a provided VRAM address (0..0x3FFF), applying deglitch filter
  private detectA12FromAddr(a: Word): void {
    const addr = a & 0x3FFF;
    const a12 = (addr >> 12) & 1;
    if (a12 === 0) {
      this.a12LastLowDot = this.dot;
    }
    if (this.lastA12 === 0 && a12 === 1) {
      if (this.dot - this.a12LastLowDot >= this.a12Filter) {
        if (this.traceEnabled) {
          if (this.traceA12.length > 1024) this.traceA12.shift();
          this.traceA12.push({ frame: this.frame, scanline: this.scanline, cycle: this.cycle });
        }
        this.onA12Rise && this.onA12Rise();
      }
    }
    this.lastA12 = a12;
  }

  // Manual A12 evaluation when VRAM address (v) changes via CPU writes (e.g., $2006)
  private evalA12FromAddr(a: Word): void {
    const addr = a & 0x3FFF;
    if (addr < 0x2000) {
      // For CPU-driven $2006 toggles, bypass deglitch: manual A12 clocks should always count
      const a12 = (addr >> 12) & 1;
      if (a12 === 0) this.a12LastLowDot = this.dot;
      if (this.lastA12 === 0 && a12 === 1) {
        if (this.traceEnabled) {
          if (this.traceA12.length > 1024) this.traceA12.shift();
          this.traceA12.push({ frame: this.frame, scanline: this.scanline, cycle: this.cycle });
        }
        this.onA12Rise && this.onA12Rise();
      }
      this.lastA12 = a12;
    } else {
      // Outside CHR space: treat as low for purposes of deglitch baseline
      this.lastA12 = 0;
      this.a12LastLowDot = this.dot;
    }
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
    // Build world coordinates from v (loopy) and the latched fine X
    const coarseXScroll = (this.v & 0x1F) << 3;
    const fineXScroll = this.latchedX & 0x07;
    const coarseYScroll = ((this.v >> 5) & 0x1F) << 3;
    const fineYScroll = (this.v >> 12) & 0x07;

    // In VT per-dot sampling, v already encodes the current scanline position; do not add output y again
    const worldX = coarseXScroll + fineXScroll + x;
    const worldY = coarseYScroll + fineYScroll;

    const fineX = worldX & 0x07;
    const fineY = worldY & 0x07;
    const coarseX = (worldX >> 3) & 0x1F;
    const coarseY = (worldY >> 3) & 0x1F;

    const baseNtX = (this.v >> 10) & 0x01;
    const baseNtY = (this.v >> 11) & 0x01;
    const ntX = (baseNtX + ((worldX >> 8) & 0x01)) & 0x01;
    const ntY = (baseNtY + ((worldY >> 8) & 0x01)) & 0x01;

    const ntBase = 0x2000 + (((ntY << 1) | ntX) * 0x400);
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

    const coarseXScroll = (this.v & 0x1F) << 3;
    const fineXScroll = this.latchedX & 0x07;
    const coarseYScroll = ((this.v >> 5) & 0x1F) << 3;
    const fineYScroll = (this.v >> 12) & 0x07;

    const worldX = coarseXScroll + fineXScroll + x;
    const worldY = coarseYScroll + fineYScroll;

    const coarseX = (worldX >> 3) & 0x1F;
    const coarseY = (worldY >> 3) & 0x1F;

    const baseNtX = (this.v >> 10) & 0x01;
    const baseNtY = (this.v >> 11) & 0x01;
    const ntX = (baseNtX + ((worldX >> 8) & 0x01)) & 0x01;
    const ntY = (baseNtY + ((worldY >> 8) & 0x01)) & 0x01;

    const ntBase = 0x2000 + (((ntY << 1) | ntX) * 0x400);
    const attAddr = ntBase + 0x3C0 + ((coarseY >> 2) * 8) + (coarseX >> 2);
    const attIndex = this.mapNametable(attAddr);
    const att = this.vram[attIndex];
    const shift = ((coarseY & 0x02) << 1) | (coarseX & 0x02);
    const pal = (att >> shift) & 0x03;
    return this.readPalette(0x00 + (pal << 2) + pix);
  }


  private sampleSprite0Pixel(x: number, y: number): number {
    // OAM[0..3] = Y, tile, attr, X
    const sy = (this.oam[0] + 1) & 0xFF;
    const tile = this.oam[1] & 0xFF;
    const attr = this.oam[2] & 0xFF;
    const sx = this.oam[3] & 0xFF;
    const height16 = (this.ctrl & 0x20) !== 0;

    const spriteH = height16 ? 16 : 8;
    if (x < sx || x >= sx + 8 || y < sy || y >= sy + spriteH) return 0;

    const flipH = (attr & 0x40) !== 0;
    const flipV = (attr & 0x80) !== 0;

    let fx = (x - sx) & 0x07;
    let fy = (y - sy) & 0x0F; // up to 15 for 8x16
    if (flipH) fx = 7 - fx;

    let base = 0x0000;
    let tileIndex = tile & 0xFF;
    let row = 0;
    if (!height16) {
      // 8x8 sprites: base from PPUCTRL bit3
      base = (this.ctrl & 0x08) ? 0x1000 : 0x0000;
      row = (flipV ? (7 - (fy & 7)) : (fy & 7));
    } else {
      // 8x16 sprites: pattern table determined by tile LSB; tile index even/odd selects table
      // Top tile = tile & 0xFE, bottom tile = top+1. Vertical flip flips the 16-line block.
      const table = (tileIndex & 1) ? 0x1000 : 0x0000;
      const topTile = tileIndex & 0xFE;
      // Compute flipped row within 16-pixel sprite
      const fy16 = flipV ? (15 - fy) : fy;
      const useTop = (fy16 < 8);
      tileIndex = useTop ? topTile : ((topTile + 1) & 0xFF);
      row = useTop ? (fy16 & 7) : ((fy16 - 8) & 7);
      base = table;
    }

    const tileAddr = (base + (tileIndex << 4) + row) & 0x1FFF;
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
        const color = (!showBgLeft && x < 8)
          ? this.readPalette(0x00)
          : this.sampleBgColor(x, y);
        buf[row + x] = color & 0x3F;
      }
    }
    return buf;
  }

  private sampleSpritePixel(x: number, y: number): { pix: number, priority: number, pal: number } | null {
    const spriteHeight16 = (this.ctrl & 0x20) !== 0;

    let result: { pix: number, priority: number, pal: number } | null = null;
    // Iterate OAM sprites; lower index has higher priority. Iterate descending so lower index wins last.
    for (let i = 63; i >= 0; i--) {
      const o = i * 4;
      const sy = ((this.oam[(o + 0) & 0xFF] + 1) & 0xFF);
      let tile = this.oam[(o + 1) & 0xFF] & 0xFF;
      const attr = this.oam[(o + 2) & 0xFF] & 0xFF;
      const sx = this.oam[(o + 3) & 0xFF] & 0xFF;

      const spriteH = spriteHeight16 ? 16 : 8;
      if (x < sx || x >= sx + 8 || y < sy || y >= sy + spriteH) continue;

      let fx = (x - sx) & 0x07;
      let fy = (y - sy) & 0x0F;
      if ((attr & 0x40) !== 0) fx = 7 - fx; // H flip

      let base = 0x0000;
      let row = 0;
      if (!spriteHeight16) {
        // 8x8
        base = (this.ctrl & 0x08) ? 0x1000 : 0x0000;
        row = ((attr & 0x80) !== 0) ? (7 - (fy & 7)) : (fy & 7);
      } else {
        // 8x16
        const table = (tile & 1) ? 0x1000 : 0x0000;
        const topTile = tile & 0xFE;
        const fy16 = ((attr & 0x80) !== 0) ? (15 - fy) : fy;
        const useTop = fy16 < 8;
        tile = useTop ? topTile : ((topTile + 1) & 0xFF);
        row = useTop ? (fy16 & 7) : ((fy16 - 8) & 7);
        base = table;
      }

      const tileAddr = (base + (tile << 4) + row) & 0x1FFF;
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
        const bgPixRaw = (this.offlineUseVT ? this.sampleBgPixelV(x, y) : this.sampleBgPixel(x, y)) & 0x03;
        const bgMasked = (!showBgLeft && x < 8);
        const bgPixEff = bgMasked ? 0 : bgPixRaw;
        const bgColor = bgPixEff === 0
          ? this.readPalette(0x00)
          : (this.offlineUseVT ? this.sampleBgColorV(x, y) : this.sampleBgColor(x, y));

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
