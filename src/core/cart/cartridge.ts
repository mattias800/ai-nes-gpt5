import type { Byte, Word } from '@core/cpu/types';
import type { INesRom } from './ines';
import { NROM } from './mappers/nrom';
import { UxROM } from './mappers/uxrom';
import { MMC3 } from './mappers/mmc3';
import { MMC6 } from './mappers/mmc6';
import { MMC1 } from './mappers/mmc1';
import { CNROM } from './mappers/cnrom';
import { MMC2 } from './mappers/mmc2';
import { AxROM } from './mappers/axrom';
import { GNROM } from './mappers/gnrom';
import { ColorDreams } from './mappers/colordreams';
import { Camerica } from './mappers/camerica';
import { VRC2_4 } from './mappers/vrc2_4';
import { FME7 } from './mappers/fme7';
import type { Mapper } from './types';

export class Cartridge {
  mapper: Mapper;
  constructor(private rom: INesRom) {
    const chrRamSize = (rom.chr.length === 0 && (rom as any).chrRamSize) ? (rom as any).chrRamSize as number : undefined;
    const prgRamSize = (rom as any).prgRamSize as number | undefined;
    const prgNvramSize = (rom as any).prgNvramSize as number | undefined;
    switch (rom.mapper) {
      case 0: this.mapper = new NROM(rom.prg, rom.chr, chrRamSize, prgRamSize ?? 0x2000, prgNvramSize ?? 0); break;
      case 1: this.mapper = new MMC1(rom.prg, rom.chr, chrRamSize, prgRamSize ?? 0x2000, prgNvramSize ?? 0); break;
      case 2: this.mapper = new UxROM(rom.prg, rom.chr, chrRamSize, prgRamSize ?? 0x2000, prgNvramSize ?? 0); break;
      case 3: this.mapper = new CNROM(rom.prg, rom.chr, chrRamSize, prgRamSize ?? 0x2000, prgNvramSize ?? 0); break;
      case 11: this.mapper = new ColorDreams(rom.prg, rom.chr, chrRamSize, prgRamSize ?? 0x2000, prgNvramSize ?? 0); break;
      case 7: this.mapper = new AxROM(rom.prg, rom.chr, chrRamSize); break;
      case 4: {
        // Prefer NES 2.0 submapper if present; otherwise honor env override; else default to MMC3.
        const nes2 = !!(rom as any).isNES2;
        const sub = (rom as any).submapper as number | undefined;
        // Mapper 4 submapper mapping (NES 2.0): consult a table to determine MMC3/MMC6 and options.
        const MMC3_SUBMAPPER_TABLE: Record<number, { useMMC6?: boolean; assertOnRel0?: boolean }> = {
          0: { /* default MMC3 */ },
          1: { /* MMC3 variant */ },
          2: { /* MMC3 variant */ },
          3: { /* MMC3 variant */ },
          4: { useMMC6: true }, // MMC6 (TxSROM/HKROM)
          5: { assertOnRel0: true }, // example: treat as 1-clocking clone
          6: { assertOnRel0: true },
          7: { assertOnRel0: true },
        };
        let useMMC6 = false;
        // MMC3 per-submapper options (extensible)
        let mmc3Opts: { assertOnRel0?: boolean, prgRamSize?: number, prgNvramSize?: number, chrRamSize?: number } = { assertOnRel0: false };
        if (nes2 && typeof sub === 'number') {
          const ent = MMC3_SUBMAPPER_TABLE[sub] || {};
          useMMC6 = !!ent.useMMC6;
          if (ent.assertOnRel0) mmc3Opts.assertOnRel0 = true;
        }
        if (!nes2) {
          // No NES 2.0: allow env override for development/testing
          try {
            const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
            if (env && env.FORCE_MMC6 === '1') useMMC6 = true;
          } catch {}
        }
        this.mapper = useMMC6
          ? new MMC6(rom.prg, rom.chr, chrRamSize)
          : new MMC3(rom.prg, rom.chr, { chrRamSize, prgRamSize: prgRamSize ?? 0x2000, prgNvramSize: prgNvramSize ?? 0, ...mmc3Opts });
        break;
      }
      case 9: this.mapper = new MMC2(rom.prg, rom.chr, chrRamSize); break;
      case 66: this.mapper = new GNROM(rom.prg, rom.chr, chrRamSize, prgRamSize ?? 0x2000, prgNvramSize ?? 0); break;
      case 69: this.mapper = new FME7(rom.prg, rom.chr, chrRamSize, prgRamSize ?? 0x2000, prgNvramSize ?? 0); break;
      case 71: this.mapper = new Camerica(rom.prg, rom.chr, chrRamSize, prgRamSize ?? 0x2000, prgNvramSize ?? 0); break;
      case 21: this.mapper = new VRC2_4(rom.prg, rom.chr, 21, chrRamSize, prgRamSize ?? 0x2000, prgNvramSize ?? 0); break;
      case 22: this.mapper = new VRC2_4(rom.prg, rom.chr, 22, chrRamSize, prgRamSize ?? 0x2000, prgNvramSize ?? 0); break;
      case 23: this.mapper = new VRC2_4(rom.prg, rom.chr, 23, chrRamSize, prgRamSize ?? 0x2000, prgNvramSize ?? 0); break;
      case 25: this.mapper = new VRC2_4(rom.prg, rom.chr, 25, chrRamSize, prgRamSize ?? 0x2000, prgNvramSize ?? 0); break;
      case 206: {
        // Treat as MMC3-compatible variant
        this.mapper = new MMC3(rom.prg, rom.chr, { chrRamSize, prgRamSize: prgRamSize ?? 0x2000, prgNvramSize: prgNvramSize ?? 0 });
        break;
      }
      default:
        throw new Error(`Mapper ${rom.mapper} not implemented`);
    }
  }

  readCpu(addr: Word): Byte {
    const val = this.mapper.cpuRead(addr);
    try {
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      if (env && env.TRACE_BLARGG === '1' && addr >= 0x6000 && addr <= 0x6003) {
        // eslint-disable-next-line no-console
        console.log(`[cart] read $${addr.toString(16).padStart(4,'0')} => $${(val&0xFF).toString(16).padStart(2,'0')}`);
      }
    } catch {}
    return val;
  }
  writeCpu(addr: Word, v: Byte): void {
    try {
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      if (env && env.TRACE_BLARGG === '1' && addr >= 0x6000 && addr <= 0x6003) {
        // eslint-disable-next-line no-console
        console.log(`[cart] write $${addr.toString(16).padStart(4,'0')} <= $${(v&0xFF).toString(16).padStart(2,'0')}`);
      }
    } catch {}
    this.mapper.cpuWrite(addr, v);
  }
  readChr(addr: Word): Byte { return this.mapper.ppuRead(addr); }
  writeChr(addr: Word, v: Byte): void { this.mapper.ppuWrite(addr, v); }

  reset(): void {
    // Reset mapper state if it has a reset method
    if (typeof (this.mapper as any).reset === 'function') {
      (this.mapper as any).reset();
    }
  }

  // Battery save serialization scaffolding
  exportBatteryRam(): Uint8Array | null {
    if ((this.mapper as any).getBatteryRam) {
      const data = (this.mapper as any).getBatteryRam();
      return data ? new Uint8Array(data) : null;
    }
    return null;
  }
  importBatteryRam(data: Uint8Array): void {
    if ((this.mapper as any).setBatteryRam && data) {
      (this.mapper as any).setBatteryRam(data);
    }
  }
}
