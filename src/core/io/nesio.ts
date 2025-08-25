import type { Byte, Word } from '@core/cpu/types';
import { PPU } from '@core/ppu/ppu';
import { CPUBus } from '@core/bus/memory';

import { Controller } from '@core/input/controller';

export class NesIO {
  private pad1 = new Controller();
  private pad2 = new Controller();

  constructor(public ppu: PPU, private bus: CPUBus) {}

  getController(index: 1|2) { return index === 1 ? this.pad1 : this.pad2; }

  read = (addr: Word): Byte => {
    switch (addr) {
      case 0x2002:
      case 0x2004:
      case 0x2007:
        return this.ppu.cpuRead(addr);
      case 0x4016:
        return this.pad1.read();
      case 0x4017:
        return this.pad2.read();
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
        this.pad1.write4016(value);
        this.pad2.write4016(value);
        break;
      }
      default:
        // Ignore other IO for now
        break;
    }
  };
}
