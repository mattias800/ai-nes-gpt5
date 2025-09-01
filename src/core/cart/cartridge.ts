import type { Byte, Word } from '@core/cpu/types';
import type { INesRom } from './ines';
import { NROM } from './mappers/nrom';
import { UxROM } from './mappers/uxrom';
import { MMC3 } from './mappers/mmc3';
import { MMC1 } from './mappers/mmc1';
import { CNROM } from './mappers/cnrom';
import { MMC2 } from './mappers/mmc2';
import type { Mapper } from './types';

export class Cartridge {
  mapper: Mapper;
  constructor(private rom: INesRom) {
    switch (rom.mapper) {
      case 0: this.mapper = new NROM(rom.prg, rom.chr); break;
      case 1: this.mapper = new MMC1(rom.prg, rom.chr); break;
      case 2: this.mapper = new UxROM(rom.prg, rom.chr); break;
      case 3: this.mapper = new CNROM(rom.prg, rom.chr); break;
      case 4: this.mapper = new MMC3(rom.prg, rom.chr); break;
      case 9: this.mapper = new MMC2(rom.prg, rom.chr); break;
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
}
