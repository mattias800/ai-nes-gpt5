import type { Byte, Word } from '@core/cpu/types';

// Minimal PPU: registers and VRAM/palette behavior for unit tests, plus basic timing flags.

export type MirrorMode = 'horizontal' | 'vertical' | 'single0' | 'single1' | 'four';

export class PPU {
  // CPU-visible registers
  ctrl = 0; // $2000
  mask = 0; // $2001
  status = 0; // $2002 (VBlank=bit7)
  oamAddr = 0; // $2003

  // Internal latches
  private w = 0; // write toggle for $2005/$2006
  private t = 0; // temp VRAM addr (15 bits)
  private v = 0; // current VRAM addr (15 bits)
  private x = 0; // fine X scroll (3 bits)

  // Memory
  private vram = new Uint8Array(0x800); // 2KB nametable RAM
  private palette = new Uint8Array(32);
  private oam = new Uint8Array(256);

  // Cartridge CHR hooks
  private chrRead: (addr: Word) => Byte = () => 0x00;
  private chrWrite: (addr: Word, value: Byte) => void = () => {};

  // Read buffer for $2007
  private readBuffer = 0;

  // Timing
  cycle = 0; // 0..340
  scanline = 0; // 0..261
  frame = 0;

  // NMI handling
  nmiOccurred = false; // VBlank edge occurred
  nmiOutput = false; // from ctrl bit7

  constructor(private mirror: MirrorMode = 'vertical') {}

  connectCHR(read: (addr: Word) => Byte, write: (addr: Word, value: Byte) => void) {
    this.chrRead = read; this.chrWrite = write;
  }

  reset() {
    this.ctrl = 0; this.mask = 0; this.status = 0;
    this.oamAddr = 0; this.w = 0; this.t = 0; this.v = 0; this.x = 0;
    this.readBuffer = 0; this.cycle = 0; this.scanline = 0; this.frame = 0;
    this.nmiOccurred = false; this.nmiOutput = false;
    this.vram.fill(0); this.palette.fill(0); this.oam.fill(0);
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
        this.nmiOutput = !!(value & 0x80);
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
          this.w = 1;
        } else {
          this.t = (this.t & 0x0C1F) | ((value & 0x07) << 12) | ((value & 0xF8) << 2);
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
      this.cycle++;
      if (this.cycle > 340) {
        this.cycle = 0;
        this.scanline++;
        if (this.scanline === 241) {
          // Enter VBlank at scanline 241, cycle 1
          this.status |= 0x80;
          if (this.nmiOutput) this.nmiOccurred = true;
        } else if (this.scanline >= 262) {
          // Pre-render line
          this.scanline = 0;
          this.frame++;
          this.status &= ~0x80; // clear vblank at start of pre-render
          this.nmiOccurred = false;
        }
      }
    }
  }

  // --- Internal PPU memory ---
  private vramIncrement(): number { return (this.ctrl & 0x04) ? 32 : 1; }

  private ppuRead(addr14: Word): Byte {
    const a = addr14 & 0x3FFF;
    if (a < 0x2000) {
      // Delegate to cartridge CHR space
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
      // Delegate to CHR RAM/ROM write
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
}
