import type { Byte, Word } from "@core/cpu/types";
import type { Mapper } from '../types';

export class NROM implements Mapper {
  private prg: Uint8Array;
  private chr: Uint8Array; // CHR ROM or RAM
  private prgMask: number;
  private prgRam = new Uint8Array(0x2000); // 8KB PRG RAM at $6000-$7FFF

  constructor(prg: Uint8Array, chr: Uint8Array = new Uint8Array(0)) {
    this.prg = prg;
    this.chr = chr.length ? chr : new Uint8Array(0x2000); // CHR RAM if none
    // NROM-128 = 16KB mirrored, NROM-256 = 32KB
    this.prgMask = prg.length === 0x4000 ? 0x3FFF : 0x7FFF;
  }

  cpuRead(addr: Word): Byte {
    if (addr >= 0x8000) {
      const index = (addr - 0x8000) & this.prgMask;
      return this.prg[index];
    }
    if (addr >= 0x6000 && addr < 0x8000) {
      return this.prgRam[addr - 0x6000];
    }
    return 0x00;
  }

  cpuWrite(addr: Word, value: Byte): void {
    if (addr >= 0x6000 && addr < 0x8000) {
      this.prgRam[addr - 0x6000] = value & 0xFF;
    }
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
