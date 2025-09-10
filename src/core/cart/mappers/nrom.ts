import type { Byte, Word } from "@core/cpu/types";
import type { Mapper } from '../types';

export class NROM implements Mapper {
  private prg: Uint8Array;
  private chr: Uint8Array; // CHR ROM or RAM
  private prgMask: number;
  private prgRam: Uint8Array; // PRG RAM/NVRAM contiguous at $6000-$7FFF
  private prgBatteryOffset = 0; // offset within prgRam that is battery-backed

  constructor(prg: Uint8Array, chr: Uint8Array = new Uint8Array(0), chrRamSize?: number, prgRamSize: number = 0x2000, prgNvramSize: number = 0) {
    this.prg = prg;
    this.chr = chr.length ? chr : new Uint8Array(chrRamSize || 0x2000); // CHR RAM if none
    // NROM-128 = 16KB mirrored, NROM-256 = 32KB
    this.prgMask = prg.length === 0x4000 ? 0x3FFF : 0x7FFF;
    const total = Math.max(0, (prgRamSize | 0)) + Math.max(0, (prgNvramSize | 0));
    this.prgRam = new Uint8Array(total || 0x2000);
    this.prgBatteryOffset = Math.max(0, (prgRamSize | 0));
  }

  cpuRead(addr: Word): Byte {
    if (addr >= 0x8000) {
      const index = (addr - 0x8000) & this.prgMask;
      return this.prg[index];
    }
    if (addr >= 0x6000 && addr < 0x8000) {
      const i = addr - 0x6000;
      if (i < this.prgRam.length) return this.prgRam[i];
      return 0x00;
    }
    return 0x00;
  }

  cpuWrite(addr: Word, value: Byte): void {
    if (addr >= 0x6000 && addr < 0x8000) {
      const i = addr - 0x6000;
      if (i < this.prgRam.length) this.prgRam[i] = value & 0xFF;
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
    return this.chr[a];
  }
  ppuWrite(addr: Word, value: Byte): void {
    const a = addr & 0x1FFF;
    if (this.chr.length) {
      // If CHR RAM
      this.chr[a] = value & 0xFF;
    }
  }
}
