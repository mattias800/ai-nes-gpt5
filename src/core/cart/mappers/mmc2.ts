import type { Byte, Word } from '@core/cpu/types';
import type { Mapper } from '../types';

// MMC2 (mapper 9)
// - PRG: 16KB switchable at $8000-$BFFF via $A000 writes; fixed last 16KB at $C000-$FFFF
// - CHR: Two 4KB halves with FD/FE latches
//   - Lower half ($0000-$0FFF): banks set by $B000 (FD) and $C000 (FE)
//   - Upper half ($1000-$1FFF): banks set by $D000 (FD) and $E000 (FE)
//   - Latches toggle on CHR read/write when (addr & 0x3FF8) matches 0x0FD8/0x0FE8/0x1FD8/0x1FE8
// - Mirroring control at $F000: LSB 0=vertical, 1=horizontal
export class MMC2 implements Mapper {
  private prg: Uint8Array;
  private chr: Uint8Array;
  private prgRam = new Uint8Array(0x2000);

  private prgBankSelect = 0; // 16KB bank at $8000

  // CHR bank registers (4KB units)
  private bankChr0FD = 0;
  private bankChr0FE = 0;
  private bankChr1FD = 0;
  private bankChr1FE = 0;

  // Latches default to FE
  private latch0: 0xFD | 0xFE = 0xFE;
  private latch1: 0xFD | 0xFE = 0xFE;

  // Mirroring: 0 vertical, 1 horizontal
  private mirroring = 0;
  private mirrorCb: ((mode: 'horizontal' | 'vertical') => void) | null = null;

  private prg16kBanks: number;
  private chr4kBanks: number;

  constructor(prg: Uint8Array, chr: Uint8Array = new Uint8Array(0)) {
    this.prg = prg;
    this.chr = chr.length ? chr : new Uint8Array(0x2000); // CHR RAM if none
    this.prg16kBanks = Math.max(1, this.prg.length >>> 14);
    this.chr4kBanks = Math.max(1, this.chr.length >>> 12);
  }

  cpuRead(addr: Word): Byte {
    addr &= 0xFFFF;
    if (addr >= 0x6000 && addr < 0x8000) return this.prgRam[addr - 0x6000];
    if (addr >= 0x8000 && addr < 0xC000) {
      const bank = (this.prgBankSelect % this.prg16kBanks) & 0xFF;
      const base = bank * 0x4000;
      return this.prg[base + (addr - 0x8000)];
    }
    if (addr >= 0xC000) {
      const base = (this.prg16kBanks - 1) * 0x4000;
      return this.prg[base + (addr - 0xC000)];
    }
    return 0x00;
  }

  cpuWrite(addr: Word, value: Byte): void {
    addr &= 0xFFFF; value &= 0xFF;
    if (addr >= 0x6000 && addr < 0x8000) { this.prgRam[addr - 0x6000] = value; return; }

    switch (addr & 0xF000) {
      case 0xA000:
        this.prgBankSelect = (value % this.prg16kBanks) >>> 0;
        break;
      case 0xB000:
        this.bankChr0FD = (value % this.chr4kBanks) >>> 0;
        break;
      case 0xC000:
        this.bankChr0FE = (value % this.chr4kBanks) >>> 0;
        break;
      case 0xD000:
        this.bankChr1FD = (value % this.chr4kBanks) >>> 0;
        break;
      case 0xE000:
        this.bankChr1FE = (value % this.chr4kBanks) >>> 0;
        break;
      case 0xF000: {
        this.mirroring = value & 1;
        if (this.mirrorCb) this.mirrorCb((this.mirroring & 1) ? 'horizontal' : 'vertical');
        break;
      }
      default:
        break;
    }
  }

  ppuRead(addr: Word): Byte {
    const a = addr & 0x1FFF;
    this.updateLatches(a);
    if (a < 0x1000) {
      const bank = (this.latch0 === 0xFD ? this.bankChr0FD : this.bankChr0FE) % this.chr4kBanks;
      const base = bank * 0x1000;
      return this.chr[base + a];
    } else {
      const bank = (this.latch1 === 0xFD ? this.bankChr1FD : this.bankChr1FE) % this.chr4kBanks;
      const base = bank * 0x1000;
      return this.chr[base + (a - 0x1000)];
    }
  }

  ppuWrite(addr: Word, value: Byte): void {
    const a = addr & 0x1FFF; value &= 0xFF;
    this.updateLatches(a);
    if (a < 0x1000) {
      const bank = (this.latch0 === 0xFD ? this.bankChr0FD : this.bankChr0FE) % this.chr4kBanks;
      const base = bank * 0x1000;
      this.chr[base + a] = value;
    } else {
      const bank = (this.latch1 === 0xFD ? this.bankChr1FD : this.bankChr1FE) % this.chr4kBanks;
      const base = bank * 0x1000;
      this.chr[base + (a - 0x1000)] = value;
    }
  }

  setMirrorCallback(cb: (mode: 'horizontal' | 'vertical') => void): void {
    this.mirrorCb = cb;
    cb((this.mirroring & 1) ? 'horizontal' : 'vertical');
  }

  reset(): void {
    this.prgRam.fill(0);
    this.prgBankSelect = 0;
    this.bankChr0FD = 0; this.bankChr0FE = 0; this.bankChr1FD = 0; this.bankChr1FE = 0;
    this.latch0 = 0xFE; this.latch1 = 0xFE;
    this.mirroring = 0;
  }

  private updateLatches(a: number): void {
    const masked = a & 0x3FF8;
    if (masked === 0x0FD8) this.latch0 = 0xFD;
    else if (masked === 0x0FE8) this.latch0 = 0xFE;
    else if (masked === 0x1FD8) this.latch1 = 0xFD;
    else if (masked === 0x1FE8) this.latch1 = 0xFE;
  }
}
