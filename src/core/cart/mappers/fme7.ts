import type { Byte, Word } from '@core/cpu/types';
import type { Mapper } from '../types';

// FME-7 (Sunsoft 5B) minimal: PRG 4x8KB banks, CHR 8x1KB banks, mirroring control.
// Register interface (simplified):
// - $8000-$9FFF: select register index (0..15)
// - $A000-$BFFF: write data for selected register
// Registers:
//   0..7   -> CHR 1KB banks 0..7
//   8..11  -> PRG 8KB banks for slots $8000,$A000,$C000,$E000 (in that order)
//   12     -> Mirroring: 0=vertical,1=horizontal,2=single0,3=single1
//   13..15 -> (IRQ control) — not implemented in this minimal variant
export class FME7 implements Mapper {
  private prg: Uint8Array;
  private chr: Uint8Array; // CHR ROM or RAM
  private prgRam: Uint8Array;
  private prgBatteryOffset = 0;

  private regSel = 0;
  private chr1k = new Uint8Array(8); // 1KB banks
  private prg8k = new Uint8Array(4); // 8KB banks for $8000,$A000,$C000,$E000
  private mirrorCb: ((mode: 'horizontal'|'vertical'|'single0'|'single1')=>void) | null = null;

  // IRQ
  private irqReload = 0;
  private irqCounter = 0;
  private irqEnable = false;
  private irqRepeat = false;
  private irqLine = false;

  constructor(prg: Uint8Array, chr: Uint8Array = new Uint8Array(0), chrRamSize?: number, prgRamSize: number = 0x2000, prgNvramSize: number = 0) {
    this.prg = prg;
    this.chr = chr.length ? chr : new Uint8Array(chrRamSize || 0x2000);
    const total = Math.max(0, prgRamSize|0) + Math.max(0, prgNvramSize|0);
    this.prgRam = new Uint8Array(total || 0x2000);
    this.prgBatteryOffset = Math.max(0, prgRamSize|0);

    // Defaults: first banks in low slots; fix last bank in $E000 slot
    const prgBanks = Math.max(1, this.prg.length >>> 13); // 8KB banks
    this.prg8k[0] = 0;
    this.prg8k[1] = Math.min(1, prgBanks-1) & 0xFF;
    this.prg8k[2] = Math.min(2, prgBanks-1) & 0xFF;
    this.prg8k[3] = (prgBanks - 1) & 0xFF; // last fixed by default
    for (let i = 0; i < 8; i++) this.chr1k[i] = i & 0xFF;
  }

  setMirrorCallback(cb: (mode: 'horizontal' | 'vertical' | 'single0' | 'single1') => void): void {
    this.mirrorCb = cb;
  }

  cpuRead(addr: Word): Byte {
    if (addr >= 0x6000 && addr < 0x8000) {
      const i = addr - 0x6000;
      if (i < this.prgRam.length) return this.prgRam[i];
      return 0x00;
    }
    if (addr >= 0x8000) {
      const off = this.mapPrg(addr);
      return this.prg[off];
    }
    return 0x00;
  }

  cpuWrite(addr: Word, value: Byte): void {
    if (addr >= 0x6000 && addr < 0x8000) {
      const i = addr - 0x6000; if (i < this.prgRam.length) this.prgRam[i] = value & 0xFF; return;
    }
    if (addr >= 0x8000 && addr <= 0x9FFF) {
      this.regSel = value & 0x0F;
      return;
    }
    if (addr >= 0xA000 && addr <= 0xBFFF) {
      this.writeReg(this.regSel, value & 0xFF);
      return;
    }
    // Ignore writes elsewhere
  }

  private writeReg(index: number, v: number): void {
    if (index >= 0 && index <= 7) {
      // CHR 1KB banks
      const banks = Math.max(1, this.chr.length >>> 10);
      this.chr1k[index] = (v % banks) & 0xFF;
      return;
    }
    if (index >= 8 && index <= 11) {
      // PRG 8KB banks for slots 0..3
      const banks = Math.max(1, this.prg.length >>> 13);
      const slot = index - 8;
      if (slot === 3) {
        // Keep last bank fixed by default; allow override (common behavior varies)
        this.prg8k[3] = (v % banks) & 0xFF;
      } else {
        this.prg8k[slot] = (v % banks) & 0xFF;
      }
      return;
    }
    if (index === 12) {
      const mode = (v & 3);
      if (this.mirrorCb) {
        if (mode === 0) this.mirrorCb('vertical');
        else if (mode === 1) this.mirrorCb('horizontal');
        else if (mode === 2) this.mirrorCb('single0');
        else this.mirrorCb('single1');
      }
      return;
    }
    // IRQ registers (minimal): 13=L, 14=H, 15=control
    if (index === 13) { // low byte
      this.irqReload = (this.irqReload & 0xFF00) | (v & 0xFF);
      return;
    }
    if (index === 14) { // high byte
      this.irqReload = ((v & 0xFF) << 8) | (this.irqReload & 0x00FF);
      return;
    }
    if (index === 15) {
      const wasEnabled = this.irqEnable;
      this.irqEnable = (v & 0x01) !== 0;
      this.irqRepeat = (v & 0x02) !== 0;
      if ((v & 0x80) !== 0) this.irqLine = false; // ack
      if (this.irqEnable && !wasEnabled) {
        this.irqCounter = Math.max(1, this.irqReload & 0xFFFF);
      }
      if (!this.irqEnable) {
        // disable and clear line
        this.irqLine = false;
      }
      return;
    }
  }

  ppuRead(addr: Word): Byte {
    const a = addr & 0x1FFF;
    const bank1k = a >>> 10; // 0..7
    const base = (this.chr1k[bank1k] & 0xFF) * 0x400;
    return this.chr[base + (a & 0x3FF)];
  }

  ppuWrite(addr: Word, value: Byte): void {
    const a = addr & 0x1FFF;
    if (this.chr.length > 0) {
      // If CHR is RAM (no ROM provided), writes are allowed
      const isRam = true; // In this implementation, chr is RAM iff original ROM had no CHR
      if (isRam) {
        const bank1k = a >>> 10;
        const base = (this.chr1k[bank1k] & 0xFF) * 0x400;
        this.chr[base + (a & 0x3FF)] = value & 0xFF;
      }
    }
  }

  private mapPrg(addr: Word): number {
    const slot = ((addr - 0x8000) >>> 13) & 3; // 8KB slot index 0..3
    const bank = this.prg8k[slot] & 0xFF;
    const off = (bank * 0x2000) + ((addr - 0x8000) & 0x1FFF);
    const mask = this.prg.length - 1;
    return off & mask;
  }

  tick(cpuCycles: number): void {
    if (!this.irqEnable) return;
    let remain = cpuCycles | 0;
    while (remain > 0 && this.irqEnable) {
      const step = Math.min(this.irqCounter, remain);
      this.irqCounter -= step;
      remain -= step;
      if (this.irqCounter <= 0) {
        this.irqLine = true;
        if (this.irqRepeat) {
          this.irqCounter = Math.max(1, this.irqReload & 0xFFFF);
        } else {
          this.irqEnable = false; // one-shot
          break;
        }
      }
    }
  }

  irqPending(): boolean { return this.irqLine; }
  clearIrq(): void { this.irqLine = false; }

  getBatteryRam(): Uint8Array | null {
    const size = this.prgRam.length - this.prgBatteryOffset;
    return size > 0 ? this.prgRam.slice(this.prgBatteryOffset) : null;
  }
  setBatteryRam(data: Uint8Array): void {
    const size = this.prgRam.length - this.prgBatteryOffset;
    if (size <= 0) return;
    const n = Math.min(size, data.length);
    this.prgRam.set(data.subarray(0, n), this.prgBatteryOffset);
  }
}

