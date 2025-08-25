import type { Byte, Word } from '@core/cpu/types';
import type { Mapper } from '../types';

// MMC3 (mapper 4) skeleton: PRG/CHR banking and IRQ registers.
export class MMC3 implements Mapper {
  private prg: Uint8Array;
  private chr: Uint8Array;
  private prgRam = new Uint8Array(0x2000);

  private bankSelect = 0;
  private bankRegs = new Uint8Array(8); // R0..R7
  private mirroring = 0; // 0: vertical, 1: horizontal (A000)
  private ramProtect = 0; // A001

  private irqLatch = 0;
  private irqCounter = 0;
  private irqEnabled = false;
  private irq = false;

  constructor(prg: Uint8Array, chr: Uint8Array = new Uint8Array(0)) {
    this.prg = prg;
    this.chr = chr.length ? chr : new Uint8Array(0x2000);
  }

  cpuRead(addr: Word): Byte {
    if (addr >= 0x6000 && addr < 0x8000) return this.prgRam[addr - 0x6000];
    if (addr >= 0x8000) {
      const banked = this.mapPrg(addr);
      return this.prg[banked];
    }
    return 0x00;
  }

  cpuWrite(addr: Word, value: Byte): void {
    if (addr >= 0x6000 && addr < 0x8000) { this.prgRam[addr - 0x6000] = value & 0xFF; return; }
    if (addr >= 0x8000 && addr <= 0x9FFE && (addr & 1) === 0) {
      this.bankSelect = value & 0x07 | ((value & 0x40) ? 0x40 : 0) | ((value & 0x80) ? 0x80 : 0);
    } else if (addr >= 0x8001 && addr <= 0x9FFF && (addr & 1) === 1) {
      const reg = this.bankSelect & 0x07;
      this.bankRegs[reg] = value;
    } else if (addr >= 0xA000 && addr <= 0xBFFE && (addr & 1) === 0) {
      this.mirroring = value & 1;
    } else if (addr >= 0xA001 && addr <= 0xBFFF && (addr & 1) === 1) {
      this.ramProtect = value & 0xE3; // not fully used here
    } else if (addr >= 0xC000 && addr <= 0xDFFE && (addr & 1) === 0) {
      this.irqLatch = value;
    } else if (addr >= 0xC001 && addr <= 0xDFFF && (addr & 1) === 1) {
      this.irqCounter = 0; // reload on next A12 rising edge
    } else if (addr >= 0xE000 && addr <= 0xFFFE && (addr & 1) === 0) {
      this.irqEnabled = false; this.irq = false;
    } else if (addr >= 0xE001 && addr <= 0xFFFF && (addr & 1) === 1) {
      this.irqEnabled = true;
    }
  }

  ppuRead(addr: Word): Byte {
    return this.chr[this.mapChr(addr & 0x1FFF)];
  }
  ppuWrite(addr: Word, value: Byte): void {
    this.chr[this.mapChr(addr & 0x1FFF)] = value & 0xFF;
  }

  irqPending(): boolean { return this.irq; }
  clearIrq(): void { this.irq = false; }

  notifyA12Rise(): void {
    // On A12 rising edge: if counter is 0, reload from latch, else decrement. When becomes 0 and enabled, set IRQ.
    if (this.irqCounter === 0) {
      this.irqCounter = this.irqLatch;
    } else {
      this.irqCounter = (this.irqCounter - 1) & 0xFF;
      if (this.irqCounter === 0 && this.irqEnabled) this.irq = true;
    }
  }

  private mapPrg(addr: Word): number {
    const mode = (this.bankSelect >> 6) & 1; // PRG mode bit
    const bank6 = this.bankRegs[6] & 0x3F;
    const bank7 = this.bankRegs[7] & 0x3F;
    const prgSize = this.prg.length;
    const last16k = prgSize - 0x4000;

    if (mode === 0) {
      // $8000-$9FFF = bank6, $A000-$BFFF = bank7, $C000-$DFFF = second-last, $E000-$FFFF = last
      if (addr < 0xA000) return (bank6 * 0x2000) + (addr - 0x8000);
      if (addr < 0xC000) return (bank7 * 0x2000) + (addr - 0xA000);
      if (addr < 0xE000) return last16k + (addr - 0xC000);
      return (prgSize - 0x2000) + (addr - 0xE000);
    } else {
      // $8000-$9FFF = fixed second-last, $A000-$BFFF = bank7, $C000-$DFFF = bank6, $E000-$FFFF = last
      if (addr < 0xA000) return last16k + (addr - 0x8000);
      if (addr < 0xC000) return (bank7 * 0x2000) + (addr - 0xA000);
      if (addr < 0xE000) return (bank6 * 0x2000) + (addr - 0xC000);
      return (prgSize - 0x2000) + (addr - 0xE000);
    }
  }

  private mapChr(addr: Word): number {
    const mode = (this.bankSelect >> 7) & 1; // CHR mode bit
    const r0 = this.bankRegs[0] & 0xFE;
    const r1 = this.bankRegs[1] & 0xFE;
    const r2 = this.bankRegs[2] & 0xFF;
    const r3 = this.bankRegs[3] & 0xFF;
    const r4 = this.bankRegs[4] & 0xFF;
    const r5 = this.bankRegs[5] & 0xFF;

    if (mode === 0) {
      // $0000-$07FF: 2KB at R0; $0800-$0FFF: 2KB at R1; $1000-$13FF:1KB R2; ... $1C00-$1FFF:1KB R5
      if (addr < 0x0800) return (r0 * 0x400) + addr;
      if (addr < 0x1000) return (r1 * 0x400) + (addr - 0x0800);
      if (addr < 0x1400) return (r2 * 0x400) + (addr - 0x1000);
      if (addr < 0x1800) return (r3 * 0x400) + (addr - 0x1400);
      if (addr < 0x1C00) return (r4 * 0x400) + (addr - 0x1800);
      return (r5 * 0x400) + (addr - 0x1C00);
    } else {
      // Invert mapping halves
      if (addr < 0x0800) return (r2 * 0x400) + addr;
      if (addr < 0x1000) return (r3 * 0x400) + (addr - 0x0800);
      if (addr < 0x1400) return (r4 * 0x400) + (addr - 0x1000);
      if (addr < 0x1800) return (r5 * 0x400) + (addr - 0x1400);
      if (addr < 0x1C00) return (r0 * 0x400) + (addr - 0x1800);
      return (r1 * 0x400) + (addr - 0x1C00);
    }
  }
}
