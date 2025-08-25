import type { Byte, Word } from "@core/cpu/types";

export class NROM {
  private prg: Uint8Array;
  private prgMask: number;

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
    return 0x00;
  }

  write(_addr: Word, _value: Byte): void {
    // NROM PRG is read-only
  }
}
