import type { Byte, Word } from '@core/cpu/types';
import type { Mapper } from '../types';
import { MMC3 } from './mmc3';

// MMC6: Variant of MMC3 with 1KB WRAM at $6000-$7FFF (mirrored every 1KB) and similar
// PRG/CHR banking + IRQ behavior. We delegate to MMC3 for all functionality except WRAM.
export class MMC6 implements Mapper {
  private inner: MMC3;
  private wram = new Uint8Array(0x0400); // 1KB
  private wramEnable = false;
  private wramWriteProtect = false;

  constructor(prg: Uint8Array, chr: Uint8Array = new Uint8Array(0), chrRamSize?: number) {
    this.inner = new MMC3(prg, chr, { chrRamSize });
  }

  reset(): void {
    this.inner.reset();
    this.wram.fill(0);
    this.wramEnable = false;
    this.wramWriteProtect = false;
  }

  cpuRead(addr: Word): Byte {
    if (addr >= 0x6000 && addr < 0x8000) {
      if (!this.wramEnable) return 0x00;
      return this.wram[(addr - 0x6000) & 0x03FF];
    }
    return this.inner.cpuRead(addr);
  }

  cpuWrite(addr: Word, value: Byte): void {
    if (addr >= 0x6000 && addr < 0x8000) {
      if (this.wramEnable && !this.wramWriteProtect) this.wram[(addr - 0x6000) & 0x03FF] = value & 0xFF;
      return;
    }
    // Track WRAM control (A001 odd)
    if (addr >= 0xA001 && addr <= 0xBFFF && (addr & 1) === 1) {
      this.wramEnable = !!(value & 0x80);
      this.wramWriteProtect = !!(value & 0x40);
    }
    this.inner.cpuWrite(addr, value);
  }

  ppuRead(addr: Word): Byte { return this.inner.ppuRead(addr); }
  ppuWrite(addr: Word, value: Byte): void { this.inner.ppuWrite(addr, value); }

  // IRQ surface
  irqPending?(): boolean { return this.inner.irqPending ? this.inner.irqPending() : false; }
  clearIrq?(): void { this.inner.clearIrq && this.inner.clearIrq(); }
  notifyA12Rise?(): void { this.inner.notifyA12Rise && this.inner.notifyA12Rise(); }

  // Mirroring control pass-through
  setMirrorCallback?(cb: (mode: 'horizontal' | 'vertical' | 'single0' | 'single1') => void): void {
    this.inner.setMirrorCallback && this.inner.setMirrorCallback(cb as any);
  }
  // MMC6 battery RAM is board-specific; omit battery surface for now (1KB internal WRAM typically not battery-backed)

  // Time/control providers for diagnostics/IRQ trace (non-interface helpers)
  setTimeProvider?(fn: () => { frame: number, scanline: number, cycle: number }): void {
    (this.inner as any).setTimeProvider?.(fn);
  }
  setCtrlProvider?(fn: () => number): void {
    (this.inner as any).setCtrlProvider?.(fn);
  }
}
