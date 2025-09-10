import type { Byte, Word } from '@core/cpu/types';
import type { Mapper } from '../types';

// AxROM (Mapper 7)
// - 32KB PRG banking at $8000-$FFFF
// - One-screen mirroring controlled by bit4 of bank register (0=single0, 1=single1)
// - Typically CHR RAM (8KB) since there is no CHR ROM bank switching
export class AxROM implements Mapper {
  private prg: Uint8Array;
  private chr: Uint8Array;
  private prgRam = new Uint8Array(0x2000); // 8KB PRG RAM at $6000-$7FFF (some boards lack it, but keep it simple)

  private bankReg = 0; // bits 0..n: PRG bank select, bit4: mirroring
  private prgBankCount: number; // number of 32KB banks
  private mirrorCb: ((mode: 'horizontal'|'vertical'|'single0'|'single1') => void) | null = null;

  constructor(prg: Uint8Array, chr: Uint8Array = new Uint8Array(0), chrRamSize?: number) {
    this.prg = prg;
    this.chr = chr.length ? chr : new Uint8Array(chrRamSize || 0x2000); // 8KB CHR RAM if no CHR ROM
    this.prgBankCount = Math.max(1, (prg.length / 0x8000) | 0);
  }

  reset(): void {
    // Do not force mirroring on reset to allow iNES-set mirroring to persist until first write.
    // Bank defaults to 0.
    this.bankReg = 0;
  }

  private effectiveBank(): number {
    // Use modulo to accommodate any number of 32KB banks.
    const bank = this.bankReg & 0x1F; // accept up to 32 banks if present
    return this.prgBankCount > 0 ? (bank % this.prgBankCount) : 0;
  }

  private applyMirror(): void {
    if (!this.mirrorCb) return;
    const single1 = (this.bankReg & 0x10) !== 0;
    this.mirrorCb(single1 ? 'single1' : 'single0');
  }

  cpuRead(addr: Word): Byte {
    if (addr >= 0x8000) {
      const bankBase = this.effectiveBank() * 0x8000;
      const offset = bankBase + ((addr - 0x8000) & 0x7FFF);
      return this.prg[offset];
    }
    if (addr >= 0x6000 && addr < 0x8000) return this.prgRam[addr - 0x6000];
    return 0x00;
  }

  cpuWrite(addr: Word, value: Byte): void {
    if (addr >= 0x8000) {
      this.bankReg = value & 0xFF;
      this.applyMirror();
      return;
    }
    if (addr >= 0x6000 && addr < 0x8000) this.prgRam[addr - 0x6000] = value & 0xFF;
  }

  ppuRead(addr: Word): Byte { return this.chr[addr & 0x1FFF]; }
  ppuWrite(addr: Word, value: Byte): void { this.chr[addr & 0x1FFF] = value & 0xFF; }

  setMirrorCallback(cb: (mode: 'horizontal'|'vertical'|'single0'|'single1') => void): void {
    this.mirrorCb = cb;
    // Do not override iNES mirroring until the game writes to $8000.
    // If desired, uncomment the following line to force single0 on power-up:
    // this.applyMirror();
  }
}
