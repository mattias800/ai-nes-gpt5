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
  private prgRam = new Uint8Array(0x2000);

  constructor(prg: Uint8Array, chr: Uint8Array = new Uint8Array(0)) {
    this.prg = prg;
    this.chr = chr.length ? chr : new Uint8Array(0x2000);
    this.prgBankCount = prg.length / 0x4000; // 16KB banks
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
    if (addr >= 0x6000 && addr < 0x8000) return this.prgRam[addr - 0x6000];
    return 0x00;
  }

  cpuWrite(addr: Word, value: Byte): void {
    if (addr >= 0x8000) {
      this.bankSelect = value & 0x0F;
      return;
    }
    if (addr >= 0x6000 && addr < 0x8000) this.prgRam[addr - 0x6000] = value & 0xFF;
  }

  ppuRead(addr: Word): Byte { return this.chr[addr & 0x1FFF]; }
  ppuWrite(addr: Word, value: Byte): void { this.chr[addr & 0x1FFF] = value & 0xFF; }
}
