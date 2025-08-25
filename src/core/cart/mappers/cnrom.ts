import type { Byte, Word } from '@core/cpu/types';
import type { Mapper } from '../types';

// CNROM (mapper 3):
// - Fixed 32KB PRG at $8000-$FFFF
// - Switch 8KB CHR bank at $0000-$1FFF via $8000-$FFFF writes (lower 2 bits)
export class CNROM implements Mapper {
  private prg: Uint8Array;
  private chr: Uint8Array;
  private prgRam = new Uint8Array(0x2000);
  private chrBank = 0;
  private chrBanks: number;

  constructor(prg: Uint8Array, chr: Uint8Array) {
    this.prg = prg;
    this.chr = chr.length ? chr : new Uint8Array(0x2000);
    this.chrBanks = Math.max(1, chr.length / 0x2000);
  }

  cpuRead(addr: Word): Byte {
    if (addr >= 0x6000 && addr < 0x8000) return this.prgRam[addr - 0x6000];
    if (addr >= 0x8000) return this.prg[addr - 0x8000];
    return 0x00;
  }
  cpuWrite(addr: Word, value: Byte): void {
    if (addr >= 0x6000 && addr < 0x8000) { this.prgRam[addr - 0x6000] = value & 0xFF; return; }
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
}
