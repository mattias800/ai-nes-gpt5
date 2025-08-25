import type { Byte, Word } from "@core/cpu/types";

export class NROM {
  private prg: Uint8Array;
  private prgMask: number;
  private prgRam = new Uint8Array(0x2000); // 8KB PRG RAM at $6000-$7FFF

  constructor(prg: Uint8Array) {
    this.prg = prg;
    // NROM-128 = 16KB mirrored, NROM-256 = 32KB
    this.prgMask = prg.length === 0x4000 ? 0x3FFF : 0x7FFF;
  }

  read(addr: Word): Byte {
    if (addr >= 0x8000) {
      const index = (addr - 0x8000) & this.prgMask;
      return this.prg[index];
    }
    if (addr >= 0x6000 && addr < 0x8000) {
      return this.prgRam[addr - 0x6000];
    }
    return 0x00;
  }

  write(addr: Word, value: Byte): void {
    if (addr >= 0x6000 && addr < 0x8000) {
      this.prgRam[addr - 0x6000] = value & 0xFF;
    }
    // NROM PRG is read-only
  }
}
