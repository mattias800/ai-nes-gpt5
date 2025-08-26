import type { Byte, Word } from '@core/cpu/types';
import { PPU } from '@core/ppu/ppu';
import { CPUBus } from '@core/bus/memory';

import { Controller } from '@core/input/controller';

export class NesIO {
  private pad1 = new Controller();
  private pad2 = new Controller();
  private getCpuCycles: (() => number) | null = null;
  private addCpuCycles: ((n: number) => void) | null = null;
  private apu: import('@core/apu/apu').APU | null = null;

  constructor(public ppu: PPU, private bus: CPUBus) {}

  attachAPU(apu: import('@core/apu/apu').APU) { this.apu = apu; }

  setCpuCycleHooks(getter: () => number, adder: (n: number) => void) {
    this.getCpuCycles = getter; this.addCpuCycles = adder;
  }

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
      case 0x4015:
        return this.apu ? this.apu.read4015() : 0x00;
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
        // CPU stalls for 513 or 514 cycles depending on current cycle parity
        if (this.getCpuCycles && this.addCpuCycles) {
          const cyc = this.getCpuCycles();
          const stall = (cyc & 1) ? 514 : 513;
          this.addCpuCycles(stall);
        }
        break;
      }
      case 0x4016: {
        this.pad1.write4016(value);
        this.pad2.write4016(value);
        break;
      }
      case 0x4017: {
        if (this.apu) this.apu.write4017(value);
        break;
      }
      case 0x4015: {
        if (this.apu) this.apu.write4015(value);
        break;
      }
      default:
        // Forward APU register range to APU if present
        if (addr >= 0x4000 && addr <= 0x4013) {
          if (this.apu && (this.apu as any).writeRegister) (this.apu as any).writeRegister(addr, value);
          break;
        }
        // Ignore other IO for now
        break;
    }
  };
}
