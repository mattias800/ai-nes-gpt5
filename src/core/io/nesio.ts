import type { Byte, Word } from '@core/cpu/types';
import { PPU } from '@core/ppu/ppu';
import { CPUBus } from '@core/bus/memory';

export class NesIO {
  constructor(public ppu: PPU, private bus: CPUBus) {}

  read = (addr: Word): Byte => {
    switch (addr) {
      case 0x2002:
      case 0x2004:
      case 0x2007:
        return this.ppu.cpuRead(addr);
      case 0x4016:
      case 0x4017:
        // Controller read (stub: return 0x40 with no buttons)
        return 0x40;
      default:
        return 0x00;
    }
  };

  write = (addr: Word, value: Byte): void => {
    switch (addr) {
      case 0x2000:
      case 0x2001:
      case 0x2003:
      case 0x2004:
      case 0x2005:
      case 0x2006:
      case 0x2007:
        this.ppu.cpuWrite(addr, value);
        break;
      case 0x4014: { // OAM DMA
        this.ppu.oamDMA((a) => this.bus.read(a), value);
        break;
      }
      case 0x4016: {
        // Controller strobe (stub)
        break;
      }
      default:
        // Ignore other IO for now
        break;
    }
  };
}
