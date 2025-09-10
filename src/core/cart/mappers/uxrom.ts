import type { Byte, Word } from '@core/cpu/types';
import type { Mapper } from '../types';

// UxROM (mapper 2):
// - Switchable 16KB bank at $8000-$BFFF
// - Fixed last 16KB at $C000-$FFFF
// - Optional CHR RAM
export class UxROM implements Mapper {
  private prg: Uint8Array;
  private chr: Uint8Array;
  private bankSelect = 0;
  private prgBankCount: number;
  private prgRam: Uint8Array;
  private prgBatteryOffset = 0;

  constructor(prg: Uint8Array, chr: Uint8Array = new Uint8Array(0), chrRamSize?: number, prgRamSize: number = 0x2000, prgNvramSize: number = 0) {
    this.prg = prg;
    this.chr = chr.length ? chr : new Uint8Array(chrRamSize || 0x2000);
    this.prgBankCount = prg.length / 0x4000; // 16KB banks
    const total = Math.max(0, (prgRamSize | 0)) + Math.max(0, (prgNvramSize | 0));
    this.prgRam = new Uint8Array(total || 0x2000);
    this.prgBatteryOffset = Math.max(0, (prgRamSize | 0));
  }

  cpuRead(addr: Word): Byte {
    if (addr >= 0x8000 && addr < 0xC000) {
      const bank = this.bankSelect % this.prgBankCount;
      const offset = (addr - 0x8000) + bank * 0x4000;
      return this.prg[offset];
    }
    if (addr >= 0xC000) {
      const offset = (addr - 0xC000) + (this.prg.length - 0x4000);
      return this.prg[offset];
    }
    if (addr >= 0x6000 && addr < 0x8000) {
      const i = addr - 0x6000;
      if (i < this.prgRam.length) return this.prgRam[i];
      return 0x00;
    }
    return 0x00;
  }

  cpuWrite(addr: Word, value: Byte): void {
    if (addr >= 0x8000) {
      this.bankSelect = value & 0x0F;
      return;
    }
    if (addr >= 0x6000 && addr < 0x8000) {
      const i = addr - 0x6000;
      if (i < this.prgRam.length) this.prgRam[i] = value & 0xFF;
    }
  }

  ppuRead(addr: Word): Byte { return this.chr[addr & 0x1FFF]; }
  ppuWrite(addr: Word, value: Byte): void { this.chr[addr & 0x1FFF] = value & 0xFF; }

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
