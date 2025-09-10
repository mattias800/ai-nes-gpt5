import type { Byte, Word } from '@core/cpu/types';
import type { Mapper } from '../types';

// Minimal VRC2/VRC4 (mappers 21/22/23/25) implementation
// Simplified for initial compatibility: 
// - PRG: 16KB bank at $8000-$BFFF (selectable), fixed last 16KB at $C000-$FFFF
// - CHR: 8KB bank at $0000-$1FFF (selectable)
// - Mirroring: $9000 LSB (0=vertical,1=horizontal)
// Note: Real VRC2/4 have 8KB PRG and 1KB CHR banks with variant-specific register layouts.
// This minimal version aims to boot simple ROMs and demos; refine per submapper later.
export class VRC2_4 implements Mapper {
  private prg: Uint8Array;
  private chr: Uint8Array;
  private prgRam: Uint8Array;
  private prgBatteryOffset = 0;

  private prg16kBank = 0; // at $8000-$BFFF
  private chr8kBank = 0;  // at $0000-$1FFF
  private mirrorCb: ((mode: 'horizontal'|'vertical'|'single0'|'single1') => void) | null = null;

  constructor(
    prg: Uint8Array,
    chr: Uint8Array = new Uint8Array(0),
    private mapperNum: number = 22,
    chrRamSize?: number,
    prgRamSize: number = 0x2000,
    prgNvramSize: number = 0,
  ) {
    this.prg = prg;
    this.chr = chr.length ? chr : new Uint8Array(chrRamSize || 0x2000);
    const total = Math.max(0, prgRamSize|0) + Math.max(0, prgNvramSize|0);
    this.prgRam = new Uint8Array(total || 0x2000);
    this.prgBatteryOffset = Math.max(0, prgRamSize|0);
  }

  cpuRead(addr: Word): Byte {
    const a = addr & 0xFFFF;
    if (a >= 0x8000 && a < 0xC000) {
      const base = (this.prg16kBank * 0x4000) % Math.max(0x4000, this.prg.length);
      return this.prg[base + (a - 0x8000)];
    }
    if (a >= 0xC000) {
      const base = Math.max(0, this.prg.length - 0x4000);
      return this.prg[base + (a - 0xC000)];
    }
    if (a >= 0x6000 && a < 0x8000) {
      const i = a - 0x6000; if (i < this.prgRam.length) return this.prgRam[i];
      return 0x00;
    }
    return 0x00;
  }

  cpuWrite(addr: Word, value: Byte): void {
    const a = addr & 0xFFFF; const v = value & 0xFF;
    if (a >= 0x6000 && a < 0x8000) { const i = a - 0x6000; if (i < this.prgRam.length) this.prgRam[i] = v; return; }
    // Minimal register map (variant-neutral):
    // $8000: PRG 16KB bank
    // $9000: mirroring control
    // $A000: CHR 8KB bank
    if (a >= 0x8000 && a < 0x9000) {
      this.prg16kBank = v & 0x0F;
      return;
    }
    if (a >= 0x9000 && a < 0xA000) {
      if (this.mirrorCb) this.mirrorCb((v & 1) ? 'horizontal' : 'vertical');
      return;
    }
    if (a >= 0xA000 && a < 0xB000) {
      this.chr8kBank = v & 0x1F;
      return;
    }
    // ignore others for now
  }

  ppuRead(addr: Word): Byte {
    const a = addr & 0x1FFF;
    const base = (this.chr8kBank * 0x2000) % Math.max(0x2000, this.chr.length);
    return this.chr[base + a];
  }
  ppuWrite(addr: Word, value: Byte): void {
    const a = addr & 0x1FFF; const v = value & 0xFF;
    const base = (this.chr8kBank * 0x2000) % Math.max(0x2000, this.chr.length);
    this.chr[base + a] = v;
  }

  setMirrorCallback(cb: (mode: 'horizontal'|'vertical'|'single0'|'single1') => void): void {
    this.mirrorCb = cb;
  }

  getBatteryRam(): Uint8Array | null {
    const size = this.prgRam.length - this.prgBatteryOffset;
    return size > 0 ? this.prgRam.slice(this.prgBatteryOffset) : null;
  }
  setBatteryRam(data: Uint8Array): void {
    const size = this.prgRam.length - this.prgBatteryOffset;
    if (size <= 0) return;
    const n = Math.min(size, data.length);
    this.prgRam.set(data.subarray(0, n), this.prgBatteryOffset);
  }
}
