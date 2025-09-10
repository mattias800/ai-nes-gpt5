import type { Byte, Word } from '@core/cpu/types';
import type { Mapper } from '../types';

// MMC1 (mapper 1) simplified
export class MMC1 implements Mapper {
  private prg: Uint8Array;
  private chr: Uint8Array;
  private prgRam: Uint8Array;
  private prgBatteryOffset = 0;

  private shift = 0x10; // bit4=1 indicates empty
  private control = 0x0C; // default
  private chrBank0 = 0;
  private chrBank1 = 0;
  private prgBank = 0;

  constructor(prg: Uint8Array, chr: Uint8Array = new Uint8Array(0), chrRamSize?: number, prgRamSize: number = 0x2000, prgNvramSize: number = 0) {
    this.prg = prg;
    this.chr = chr.length ? chr : new Uint8Array(chrRamSize || 0x2000);
    const total = Math.max(0, prgRamSize|0) + Math.max(0, prgNvramSize|0);
    this.prgRam = new Uint8Array(total || 0x2000);
    this.prgBatteryOffset = Math.max(0, prgRamSize|0);
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
    if (addr >= 0x6000 && addr < 0x8000) { const i = addr - 0x6000; if (i < this.prgRam.length) this.prgRam[i] = value & 0xFF; return; }
    if (addr < 0x8000) return;

    if (value & 0x80) {
      // Reset shift
      this.shift = 0x10;
      this.control |= 0x0C; // set PRG mode to 3
      return;
    }
    const complete = (this.shift & 1) === 1;
    this.shift = (this.shift >>> 1) | ((value & 1) << 4);
    if (complete) {
      const data = this.shift & 0x1F;
      if (addr < 0xA000) {
        this.control = data;
      } else if (addr < 0xC000) {
        this.chrBank0 = data;
      } else if (addr < 0xE000) {
        this.chrBank1 = data;
      } else {
        this.prgBank = data & 0x0F;
      }
      this.shift = 0x10;
    }
  }

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

  ppuRead(addr: Word): Byte {
    const a = addr & 0x1FFF;
    const chrMode = (this.control >> 4) & 1;
    if (chrMode === 0) {
      const bank = (this.chrBank0 & 0x1E) * 0x1000; // 8KB
      return this.chr[bank + a];
    } else {
      if (a < 0x1000) return this.chr[(this.chrBank0 * 0x1000) + a];
      return this.chr[(this.chrBank1 * 0x1000) + (a - 0x1000)];
    }
  }
  ppuWrite(addr: Word, value: Byte): void {
    const a = addr & 0x1FFF;
    const chrMode = (this.control >> 4) & 1;
    if (chrMode === 0) {
      const bank = (this.chrBank0 & 0x1E) * 0x1000;
      this.chr[bank + a] = value & 0xFF;
    } else {
      if (a < 0x1000) this.chr[(this.chrBank0 * 0x1000) + a] = value & 0xFF;
      else this.chr[(this.chrBank1 * 0x1000) + (a - 0x1000)] = value & 0xFF;
    }
  }

  private mapPrg(addr: Word): number {
    const mode = (this.control >> 2) & 0x03;
    const prgSize = this.prg.length;
    switch (mode) {
      case 0: case 1: {
        // 32KB switch at $8000; ignore low bit
        const bank = (this.prgBank & 0x0E) * 0x4000;
        return bank + (addr - 0x8000);
      }
      case 2: {
        // fix first 16KB at $8000; switch $C000
        if (addr < 0xC000) return (addr - 0x8000);
        const bank = this.prgBank * 0x4000;
        return bank + (addr - 0xC000);
      }
      case 3: default: {
        // switch $8000; fix last 16KB at $C000
        if (addr < 0xC000) {
          const bank = this.prgBank * 0x4000;
          return bank + (addr - 0x8000);
        }
        return (prgSize - 0x4000) + (addr - 0xC000);
      }
    }
  }
}
