import type { Byte, Word } from '@core/cpu/types';
import type { Mapper } from '../types';

// Camerica (Mapper 71) simplified
// - 32KB PRG banking via writes to $8000-$FFFF (low 4 bits)
// - CHR typically RAM; no CHR banking modeled here
export class Camerica implements Mapper {
  private prg: Uint8Array;
  private chr: Uint8Array;
  private prgBank = 0;
  private prgRam: Uint8Array;
  private prgBatteryOffset = 0;

  constructor(prg: Uint8Array, chr: Uint8Array = new Uint8Array(0), chrRamSize?: number, prgRamSize: number = 0x2000, prgNvramSize: number = 0) {
    this.prg = prg;
    this.chr = chr.length ? chr : new Uint8Array(chrRamSize || 0x2000);
    const total = Math.max(0, prgRamSize|0) + Math.max(0, prgNvramSize|0);
    this.prgRam = new Uint8Array(total || 0x2000);
    this.prgBatteryOffset = Math.max(0, prgRamSize|0);
  }

  cpuRead(addr: Word): Byte {
    if (addr >= 0x8000) {
      const bank = this.prgBank & 0x0F;
      const base = (bank * 0x8000) % Math.max(0x8000, this.prg.length);
      return this.prg[base + ((addr - 0x8000) & 0x7FFF)];
    }
    if (addr >= 0x6000 && addr < 0x8000) {
      const i = addr - 0x6000; if (i < this.prgRam.length) return this.prgRam[i];
      return 0x00;
    }
    return 0x00;
  }

  cpuWrite(addr: Word, value: Byte): void {
    if (addr >= 0x8000) { this.prgBank = value & 0x0F; return; }
    if (addr >= 0x6000 && addr < 0x8000) { const i = addr - 0x6000; if (i < this.prgRam.length) this.prgRam[i] = value & 0xFF; }
  }

  ppuRead(addr: Word): Byte { return this.chr[addr & 0x1FFF]; }
  ppuWrite(addr: Word, value: Byte): void { this.chr[addr & 0x1FFF] = value & 0xFF; }

  getBatteryRam(): Uint8Array | null {
    const size = this.prgRam.length - this.prgBatteryOffset;
    return size > 0 ? this.prgRam.slice(this.prgBatteryOffset) : null;
  }
  setBatteryRam(data: Uint8Array): void {
    const size = this.prgRam.length - this.prgBatteryOffset; if (size <= 0) return;
    const n = Math.min(size, data.length);
    this.prgRam.set(data.subarray(0, n), this.prgBatteryOffset);
  }
}
