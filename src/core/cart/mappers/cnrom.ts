import type { Byte, Word } from '@core/cpu/types';
import type { Mapper } from '../types';

// CNROM (mapper 3):
// - Fixed 32KB PRG at $8000-$FFFF
// - Switch 8KB CHR bank at $0000-$1FFF via $8000-$FFFF writes (lower 2 bits)
export class CNROM implements Mapper {
  private prg: Uint8Array;
  private chr: Uint8Array;
  private prgRam: Uint8Array;
  private prgBatteryOffset = 0;
  private chrBank = 0;
  private chrBanks: number;

  constructor(prg: Uint8Array, chr: Uint8Array = new Uint8Array(0), chrRamSize?: number, prgRamSize: number = 0x2000, prgNvramSize: number = 0) {
    this.prg = prg;
    this.chr = chr.length ? chr : new Uint8Array(chrRamSize || 0x2000);
    this.chrBanks = Math.max(1, this.chr.length / 0x2000);
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
    if (addr >= 0x8000) return this.prg[addr - 0x8000];
    return 0x00;
  }
  cpuWrite(addr: Word, value: Byte): void {
    if (addr >= 0x6000 && addr < 0x8000) { const i = addr - 0x6000; if (i < this.prgRam.length) { this.prgRam[i] = value & 0xFF; } return; }
    if (addr >= 0x8000) this.chrBank = (value & 0x03) % this.chrBanks; // lower 2 bits, modulo bank count
  }

  ppuRead(addr: Word): Byte {
    const bankBase = this.chrBank * 0x2000;
    return this.chr[bankBase + (addr & 0x1FFF)];
  }
  ppuWrite(addr: Word, value: Byte): void {
    const bankBase = this.chrBank * 0x2000;
    this.chr[bankBase + (addr & 0x1FFF)] = value & 0xFF;
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
}
