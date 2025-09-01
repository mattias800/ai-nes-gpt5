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
      case 0x4015: {
        const v = this.apu ? this.apu.read4015() : 0x00;
        try {
          const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
          const cyc = this.getCpuCycles ? this.getCpuCycles() : 0;
          let log = false;
          if (env && env.TRACE_APU_4015 === '1') log = true;
          // Optional targeted read trace within a cycles window and address filter
          const win = env?.TRACE_READ_WINDOW as string | undefined;
          const addrs = env?.TRACE_READ_ADDRS as string | undefined;
          let inWin = true;
          if (win) {
            const m = /^(\d+)-(\d+)$/.exec(win);
            if (m) { const a = parseInt(m[1], 10) | 0; const b = parseInt(m[2], 10) | 0; inWin = cyc >= a && cyc <= b; }
          }
          let addrMatch = true;
          if (addrs) {
            const set = new Set(addrs.split(',').map(s => parseInt(s.trim(), 16) & 0xFFFF));
            addrMatch = set.has(0x4015);
          }
          if (inWin && addrMatch && (log || win || addrs)) {
            // eslint-disable-next-line no-console
            console.log(`[io] read $4015 => $${(v&0xFF).toString(16).padStart(2,'0')} at CPU cyc=${cyc}`);
          }
        } catch {}
        return v;
      }
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
          // Advance CPU cycle counter
          this.addCpuCycles(stall);
          // Keep PPU/APU in sync during DMA stall
          try { this.ppu.tick(stall * 3); } catch {}
          try { if (this.apu) (this.apu as any).tick?.(stall); } catch {}
        }
        break;
      }
      case 0x4016: {
        this.pad1.write4016(value);
        this.pad2.write4016(value);
        break;
      }
      case 0x4017: {
        try {
          const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
          if (env && env.TRACE_APU_4015 === '1') {
            const cyc = this.getCpuCycles ? this.getCpuCycles() : 0;
            // eslint-disable-next-line no-console
            console.log(`[io] write $4017 <= $${(value&0xFF).toString(16).padStart(2,'0')} at CPU cyc=${cyc}`);
          }
        } catch {}
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
