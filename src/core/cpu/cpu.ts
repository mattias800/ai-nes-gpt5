import type { Byte, Word, CPUState } from './types';
import { CPUBus } from '@core/bus/memory';

export class CPU6502 {
  state: CPUState;
  constructor(private bus: CPUBus) {
    this.state = { a:0,x:0,y:0,s:0xfd,pc:0,p:0x24,cycles:0 };
  }

  reset(vector: Word) {
    this.state = { a:0,x:0,y:0,s:0xfd,pc:vector,p:0x24,cycles:0 };
  }

  private read(addr: Word): Byte { return this.bus.read(addr); }
  private write(addr: Word, v: Byte): void { this.bus.write(addr, v); }

  step(): void {
    const pc = this.state.pc;
    const opcode = this.read(pc);
    this.state.pc = (pc + 1) & 0xFFFF;
    switch (opcode) {
      // Minimal subset to bootstrap tests; full set will be added incrementally
      case 0xEA: // NOP
        this.state.cycles += 2; break;
      default:
        throw new Error(`Opcode not implemented: $${opcode.toString(16)}`);
    }
  }
}
