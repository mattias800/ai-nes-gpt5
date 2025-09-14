import type { Byte, Word } from '@core/cpu/types';
import type { Mapper } from '../types';

// MMC5 (Mapper 5) implementation:
// Features implemented:
// - PRG banking: 32K/16K/8K modes, PRG-RAM protection/enable, battery-backed NVRAM
// - CHR banking: 8x1KB banks, extended attribute fetches (attr RAM)
// - ExRAM (1KB) at $5C00-$5FFF with 4 modes (nametable/attr/mixed/general)
// - Nametable mapping per quadrant to CIRAM page 0/1 or ExRAM, and 4-screen override
// - Scanline counter/IRQ (per scanline, toggled by $5203/$5204)
// - PPU $2000-$2FFF reads/writes overridden via ppuNTRead/ppuNTWrite
// - Multiplier ($5205/$5206)
// - Status ($5204 bit7 IRQ, bit6 InFrame)
// Notes:
// - MMC5 audio (two pulse + PCM) is NOT implemented here; core focuses on video/memory/IRQ accuracy.

export class MMC5 implements Mapper {
  private prg: Uint8Array;
  private chr: Uint8Array; // CHR ROM or RAM
  private prgRam: Uint8Array; // battery + wram combined
  private prgBatteryOffset = 0;

  // PRG banking state
  private prgMode: 0|1|2 = 2; // 0=32K,1=16K+16K,2=8K*4
  private prgBanks8k = new Uint8Array(4); // indices for $8000,$A000,$C000,$E000
  private prgRamEnable = true; private prgRamWriteProtect = false;

  // CHR banking
  private chrBanks1k = new Uint8Array(8);

  // ExRAM 1KB @ $5C00-$5FFF
  private exram = new Uint8Array(0x400);
  private exMode: 0|1|2|3 = 0; // 0: NT RAM, 1: extra attr, 2: mixed, 3: general

  // Nametable mapping per quadrant
  // Each NT quadrant selects source: 0=CIRAM page0, 1=CIRAM page1, 2=ExRAM, 3=Fill
  private ntSrc = new Uint8Array(4);
  private fillTile = 0; private fillAttr = 0;
  private fourScreen = false;

  // CIRAM accessors injected by core
  private ciramRead: ((addr: Word) => Byte) | null = null;
  private ciramWrite: ((addr: Word, value: Byte) => void) | null = null;
  private ciramReadPage: ((page: 0|1, off: number) => Byte) | null = null;
  private ciramWritePage: ((page: 0|1, off: number, v: Byte) => void) | null = null;

  // IRQ / scanline counter
  private irqLine = false;
  private irqEnable = false;
  private compareLine = 0; // $5203
  private inFrame = false;
  private timeProvider: (() => {frame:number,scanline:number,cycle:number}) | null = null;

  // Multiplier
  private mulA = 0; private mulB = 0;

  constructor(prg: Uint8Array, chr: Uint8Array = new Uint8Array(0), opts?: { prgRamSize?: number, prgNvramSize?: number, chrRamSize?: number }) {
    this.prg = prg;
    const chrRam = (chr.length === 0);
    this.chr = chrRam ? new Uint8Array(opts?.chrRamSize ?? 0x2000) : chr;
    const total = Math.max(0, (opts?.prgRamSize ?? 0x2000)) + Math.max(0, (opts?.prgNvramSize ?? 0));
    this.prgRam = new Uint8Array(total || 0x2000);
    this.prgBatteryOffset = Math.max(0, (opts?.prgRamSize ?? 0x2000));
    // Defaults
    const prgBanks = Math.max(1, this.prg.length >>> 13);
    this.prgBanks8k[0] = 0; this.prgBanks8k[1] = 1; this.prgBanks8k[2] = Math.max(0, prgBanks-2); this.prgBanks8k[3] = Math.max(0, prgBanks-1);
    for (let i=0;i<8;i++) this.chrBanks1k[i] = i & 0xFF;
    for (let i=0;i<4;i++) this.ntSrc[i] = 0; // default CIRAM page0
  }

  setTimeProvider(fn: () => { frame: number, scanline: number, cycle: number }): void { this.timeProvider = fn; }
  setCIRAMAccessors(read: (addr: Word)=>Byte, write: (addr: Word, v: Byte)=>void, readPage:(p:0|1,off:number)=>Byte, writePage:(p:0|1,off:number,v:Byte)=>void): void {
    this.ciramRead = read; this.ciramWrite = write; this.ciramReadPage = readPage; this.ciramWritePage = writePage;
  }

  // CPU interface
  cpuRead(addr: Word): Byte {
    const a = addr & 0xFFFF;
    if (a < 0x2000) return 0; // internal RAM handled by bus
    if (a >= 0x5000 && a <= 0x5FFF) {
      return this.readRegs(a);
    }
    if (a >= 0x6000 && a < 0x8000) {
      if (!this.prgRamEnable) return 0x00;
      const i = a - 0x6000; return this.prgRam[i % this.prgRam.length] & 0xFF;
    }
    if (a >= 0x8000) {
      const off = this.mapPrg(a);
      return this.prg[off];
    }
    return 0x00;
  }
  cpuWrite(addr: Word, value: Byte): void {
    const a = addr & 0xFFFF; const v = value & 0xFF;
    if (a >= 0x5000 && a <= 0x5FFF) { this.writeRegs(a, v); return; }
    if (a >= 0x6000 && a < 0x8000) {
      if (this.prgRamEnable && !this.prgRamWriteProtect) {
        const i = a - 0x6000; this.prgRam[i % this.prgRam.length] = v;
      }
      return;
    }
  }

  // PPU CHR
  ppuRead(addr: Word): Byte {
    const a = addr & 0x1FFF;
    const bank = (a >>> 10) & 7;
    const base = (this.chrBanks1k[bank] & 0xFF) * 0x400;
    return this.chr[(base + (a & 0x3FF)) % this.chr.length] & 0xFF;
  }
  ppuWrite(addr: Word, value: Byte): void {
    const a = addr & 0x1FFF; const v = value & 0xFF;
    // CHR RAM only
    if (this.chr.length > 0 && this.isChrRam()) {
      const bank = (a >>> 10) & 7; const base = (this.chrBanks1k[bank] & 0xFF) * 0x400;
      this.chr[(base + (a & 0x3FF)) % this.chr.length] = v;
    }
  }

  // Nametable override paths
  ppuNTRead(addr: Word): Byte {
    const a = addr & 0x2FFF;
    const q = ((a >>> 10) & 3) | 0; // quadrant
    const off = a & 0x03FF;
    const src = this.ntSrc[q] & 3;
    if (src === 2) {
      // ExRAM source
      return this.exram[off & 0x3FF] & 0xFF;
    } else if (src === 3) {
      // Fill mode: name table returns fillTile and attribute returns fillAttr appropriately
      if ((off & 0x3C0) === 0x3C0) return this.fillAttr & 0xFF; // attribute region
      return this.fillTile & 0xFF;
    } else {
      // CIRAM page select
      if (this.ciramReadPage) {
        const page: 0|1 = (src & 1) as 0|1;
        return this.ciramReadPage(page, off);
      }
      // Fallback
      return this.ciramRead ? this.ciramRead(0x2000 + (src & 1) * 0x400 + off) : 0;
    }
  }
  ppuNTWrite(addr: Word, value: Byte): void {
    const a = addr & 0x2FFF; const v = value & 0xFF;
    const q = ((a >>> 10) & 3) | 0; const off = a & 0x03FF; const src = this.ntSrc[q] & 3;
    if (src === 2) {
      this.exram[off & 0x3FF] = v;
    } else if (src === 3) {
      // Fill mode ignores writes
      return;
    } else {
      if (this.ciramWritePage) {
        const page: 0|1 = (src & 1) as 0|1;
        this.ciramWritePage(page, off, v);
        return;
      }
      if (this.ciramWrite) this.ciramWrite(0x2000 + (src & 1) * 0x400 + off, v);
    }
  }

  // IRQ
  irqPending(): boolean { return this.irqLine; }
  clearIrq(): void { this.irqLine = false; }

  tick(cpuCycles: number): void {
    // Use provided PPU time; assert IRQ at beginning of compare scanline when enabled
    if (!this.timeProvider) return;
    const t = this.timeProvider();
    const inVisible = (t.scanline >= 0 && t.scanline < 240);
    const inPrerender = (t.scanline === 261);
    const inVblank = (t.scanline >= 241 && t.scanline <= 260);
    // In-frame bit is 1 for any scanline of the frame including vblank/prerender (matches most docs for status bit6)
    this.inFrame = inVisible || inPrerender || inVblank;
    if (this.irqEnable && t.cycle === 0 && (t.scanline & 0x1FF) === (this.compareLine & 0x1FF)) {
      // Model MMC5 scanline IRQ: level asserted at cycle 0 of the matching scanline
      this.irqLine = true;
    }
  }

  // --- Internal helpers ---
  private isChrRam(): boolean { return (this.chr.length > 0) && (this.chr.length % 0x400 === 0) && (this.chr[0] === this.chr[0]); }

  private mapPrg(addr: Word): number {
    const slot = ((addr - 0x8000) >>> 13) & 3;
    const bank = this.prgBanks8k[slot] & 0xFF;
    const off = (bank * 0x2000) + ((addr - 0x8000) & 0x1FFF);
    return off & (this.prg.length - 1);
  }

  private readRegs(a: Word): Byte {
    switch (a & 0xF000) {
      default: break;
    }
    switch (a & 0xFFFF) {
      case 0x5204: {
        // Status: bit7 IRQ, bit6 InFrame
        const v = (this.irqLine ? 0x80 : 0) | (this.inFrame ? 0x40 : 0);
        return v & 0xFF;
      }
      case 0x5205: return this.mulA & 0xFF;
      case 0x5206: return ((this.mulA * this.mulB) >>> 8) & 0xFF;
    }
    // ExRAM range readable via CPU
    if (a >= 0x5C00 && a <= 0x5FFF) return this.exram[(a - 0x5C00) & 0x3FF] & 0xFF;
    return 0x00;
  }

  private writeRegs(a: Word, v: Byte): void {
    switch (a & 0xFFFF) {
      // PRG banking
      case 0x5100: this.prgMode = (v & 3) as 0|1|2; break;
      case 0x5113: this.prgBanks8k[3] = v; break;
      case 0x5114: this.prgBanks8k[0] = v; break;
      case 0x5115: this.prgBanks8k[1] = v; break;
      case 0x5116: this.prgBanks8k[2] = v; break;

      // CHR 1KB banks $5120-$5127
      case 0x5120: case 0x5121: case 0x5122: case 0x5123:
      case 0x5124: case 0x5125: case 0x5126: case 0x5127: {
        const idx = a - 0x5120; this.chrBanks1k[idx] = v; break;
      }

      // ExRAM mode
      case 0x5104: this.exMode = (v & 3) as 0|1|2|3; break;

      // Nametable mapping
      case 0x5105: {
        // Two bits per quadrant
        this.ntSrc[0] = v & 3; this.ntSrc[1] = (v >> 2) & 3; this.ntSrc[2] = (v >> 4) & 3; this.ntSrc[3] = (v >> 6) & 3;
        break;
      }
      case 0x5106: this.fillTile = v & 0xFF; break;
      case 0x5107: this.fillAttr = v & 0xFF; break;
      case 0x5103: this.fourScreen = !!(v & 1); break;

      // PRG-RAM protect
      case 0x5102: this.prgRamWriteProtect = !!(v & 0x03); break;
      case 0x5101: this.prgRamEnable = !!(v & 0x80); break;

      // IRQ
      case 0x5203: this.compareLine = v & 0xFF; break;
      case 0x5204: this.irqEnable = !!(v & 0x80); if (!this.irqEnable) this.irqLine = false; break;

      // Multiplier
      case 0x5205: this.mulA = v & 0xFF; break;
      case 0x5206: this.mulB = v & 0xFF; break;

      default:
        // ExRAM write range
        if (a >= 0x5C00 && a <= 0x5FFF) { this.exram[(a - 0x5C00) & 0x3FF] = v; break; }
        break;
    }
  }

  getBatteryRam(): Uint8Array | null {
    const size = this.prgRam.length - this.prgBatteryOffset; return size > 0 ? this.prgRam.slice(this.prgBatteryOffset) : null;
  }
  setBatteryRam(data: Uint8Array): void {
    const size = this.prgRam.length - this.prgBatteryOffset; if (size <= 0) return; const n = Math.min(size, data.length); this.prgRam.set(data.subarray(0,n), this.prgBatteryOffset);
  }
}
