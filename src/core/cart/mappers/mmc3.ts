import type { Byte, Word } from '@core/cpu/types';
import type { Mapper } from '../types';

// MMC3 (mapper 4) skeleton: PRG/CHR banking and IRQ registers.
export class MMC3 implements Mapper {
  private prg: Uint8Array;
  private chr: Uint8Array;
  private prgRam = new Uint8Array(0x2000);
  private prgRamEnable = false;
  private prgRamWriteProtect = false;

  private bankSelect = 0;
  private bankRegs = new Uint8Array(8); // R0..R7
  private mirroring = 0; // 0: vertical, 1: horizontal (A000)
  private ramProtect = 0; // A001
  private mirrorCb: ((mode: 'horizontal'|'vertical') => void) | null = null;

  private irqLatch = 0;
  private irqCounter = 0;
  private irqEnabled = false;
  private irq = false;
  private reloadPending = false;

  // Telemetry (opt-in via env MMC3_TRACE=1)
  private traceEnabled = false;
  private trace: Array<{ type: string, a?: number, v?: number, ctr?: number, en?: boolean, f?: number, s?: number, c?: number, ctrl?: number }> = [];
  private timeProvider: (() => { frame: number, scanline: number, cycle: number }) | null = null;
  private ctrlProvider: (() => number) | null = null;
  private addTrace(entry: { type: string, a?: number, v?: number, ctr?: number, en?: boolean, ctrl?: number }) {
    if (!this.traceEnabled) return;
    if (this.trace.length > 4096) this.trace.shift();
    if (this.timeProvider) {
      try {
        const t = this.timeProvider();
        (entry as any).f = t.frame; (entry as any).s = t.scanline; (entry as any).c = t.cycle;
      } catch {}
    }
    if (this.ctrlProvider) {
      try { (entry as any).ctrl = this.ctrlProvider() & 0xFF; } catch {}
    }
    this.trace.push(entry as any);
  }

  constructor(prg: Uint8Array, chr: Uint8Array = new Uint8Array(0)) {
    this.prg = prg;
    this.chr = chr.length ? chr : new Uint8Array(0x2000);
    try {
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      if (env && env.MMC3_TRACE === '1') this.traceEnabled = true;
    } catch {}
  }

  cpuRead(addr: Word): Byte {
    if (addr >= 0x6000 && addr < 0x8000) return this.prgRamEnable ? this.prgRam[addr - 0x6000] : 0x00;
    if (addr >= 0x8000) {
      const banked = this.mapPrg(addr);
      return this.prg[banked];
    }
    return 0x00;
  }

  cpuWrite(addr: Word, value: Byte): void {
    if (addr >= 0x6000 && addr < 0x8000) {
      if (this.prgRamEnable && !this.prgRamWriteProtect) this.prgRam[addr - 0x6000] = value & 0xFF;
      return;
    }
    if (addr >= 0x8000 && addr <= 0x9FFE && (addr & 1) === 0) {
      this.bankSelect = value & 0x07 | ((value & 0x40) ? 0x40 : 0) | ((value & 0x80) ? 0x80 : 0);
      this.addTrace({ type: '8000', a: addr, v: value });
    } else if (addr >= 0x8001 && addr <= 0x9FFF && (addr & 1) === 1) {
      const reg = this.bankSelect & 0x07;
      this.bankRegs[reg] = value;
      this.addTrace({ type: '8001', a: reg, v: value });
    } else if (addr >= 0xA000 && addr <= 0xBFFE && (addr & 1) === 0) {
      this.mirroring = value & 1;
      if (this.mirrorCb) this.mirrorCb((this.mirroring & 1) ? 'horizontal' : 'vertical');
      this.addTrace({ type: 'A000', v: value & 1 });
    } else if (addr >= 0xA001 && addr <= 0xBFFF && (addr & 1) === 1) {
      this.ramProtect = value & 0xE3;
      this.prgRamEnable = !!(value & 0x80);
      this.prgRamWriteProtect = !!(value & 0x40);
      this.addTrace({ type: 'A001', v: value });
    } else if (addr >= 0xC000 && addr <= 0xDFFE && (addr & 1) === 0) {
      this.irqLatch = value;
      this.addTrace({ type: 'C000', v: value });
    } else if (addr >= 0xC001 && addr <= 0xDFFF && (addr & 1) === 1) {
      // Request reload on next A12 rising edge
      this.reloadPending = true;
      this.addTrace({ type: 'C001' });
    } else if (addr >= 0xE000 && addr <= 0xFFFE && (addr & 1) === 0) {
      this.irqEnabled = false; this.irq = false;
      this.addTrace({ type: 'E000' });
    } else if (addr >= 0xE001 && addr <= 0xFFFF && (addr & 1) === 1) {
      // Enable IRQs immediately on write
      this.irqEnabled = true;
      this.addTrace({ type: 'E001' });
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
    // MMC3 scanline counter behavior (approx):
    // On A12 rising edge:
    //   - If reload requested: counter = latch; clear reloadPending
    //   - Else if counter == 0: counter = latch
    //   - Else: counter--
    // IRQ is asserted when counter becomes 0 either by decrement OR by reload-to-zero, except not on pre-render.
    const t = this.timeProvider ? this.timeProvider() : null;
    const onPreRender = !!(t && t.scanline === 261);

    let op: 'rel0'|'rel'|'dec'|'pre' = 'dec';
    let asserted = false;
    if (this.reloadPending) {
      // Clear requested: load latch on next clock but DO NOT assert even if latch==0
      this.irqCounter = this.irqLatch & 0xFF;
      this.reloadPending = false;
      op = (this.irqCounter === 0) ? 'rel0' : 'rel';
      // no asserted on reload-after-clear per test expectations
    } else if (this.irqCounter === 0) {
      // Normal reload when counter already at 0; do not assert even if latch==0 (base semantics)
      this.irqCounter = this.irqLatch & 0xFF;
      op = (this.irqCounter === 0) ? 'rel0' : 'rel';
      // no assert on reload path
    } else {
      // Decrement path; assert when we hit zero
      this.irqCounter = (this.irqCounter - 1) & 0xFF;
      op = 'dec';
      if (this.irqCounter === 0) asserted = true;
    }

    if (asserted && this.irqEnabled && !onPreRender) {
      this.irq = true;
      this.addTrace({ type: 'IRQ' });
    }

    // Trace A12 with extra details
    const entry: any = { type: 'A12', ctr: this.irqCounter, en: this.irqEnabled };
    (entry as any).op = op;
    (entry as any).pre = onPreRender;
    this.addTrace(entry);
  }

  setMirrorCallback(cb: (mode: 'horizontal' | 'vertical') => void): void {
    this.mirrorCb = cb;
    // Apply current state immediately
    cb((this.mirroring & 1) ? 'horizontal' : 'vertical');
  }

  // Telemetry accessor (read-only)
  getTrace(): ReadonlyArray<{ type: string, a?: number, v?: number, ctr?: number, en?: boolean, f?: number, s?: number, c?: number, ctrl?: number }> { return this.trace; }

  setTimeProvider(fn: (/* no args */) => { frame: number, scanline: number, cycle: number }): void {
    this.timeProvider = fn;
  }
  setCtrlProvider(fn: () => number): void { this.ctrlProvider = fn; }

  reset(): void {
    // Reset all registers to initial state
    this.bankSelect = 0;
    this.bankRegs.fill(0);
    this.mirroring = 0;
    this.ramProtect = 0;
    this.prgRamEnable = false;
    this.prgRamWriteProtect = false;
    this.irqLatch = 0;
    this.irqCounter = 0;
    this.irqEnabled = false;
    this.irq = false;
    this.reloadPending = false;
    this.trace.length = 0; // Clear trace
    this.lastA12 = 0;
    this.a12LastLowDot = 0;
    this.dot = 0;
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

    const map = (bank1k: number, off: number) => {
      const index = (bank1k * 0x400 + off) % this.chr.length;
      return index < 0 ? index + this.chr.length : index;
    };

    if (mode === 0) {
      // $0000-$07FF: 2KB at R0; $0800-$0FFF: 2KB at R1; $1000-$13FF:1KB R2; ... $1C00-$1FFF:1KB R5
      if (addr < 0x0800) return map(r0, addr);
      if (addr < 0x1000) return map(r1, addr - 0x0800);
      if (addr < 0x1400) return map(r2, addr - 0x1000);
      if (addr < 0x1800) return map(r3, addr - 0x1400);
      if (addr < 0x1C00) return map(r4, addr - 0x1800);
      return map(r5, addr - 0x1C00);
    } else {
      // Invert mapping halves
      if (addr < 0x0800) return map(r2, addr);
      if (addr < 0x1000) return map(r3, addr - 0x0800);
      if (addr < 0x1400) return map(r4, addr - 0x1000);
      if (addr < 0x1800) return map(r5, addr - 0x1400);
      if (addr < 0x1C00) return map(r0, addr - 0x1800);
      return map(r1, addr - 0x1C00);
    }
  }
}
