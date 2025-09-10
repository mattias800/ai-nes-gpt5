import type { Byte, Word, CPUState } from './types';
import { CPUBus } from '@core/bus/memory';

// Status flag bits
const C = 1 << 0;
const Z = 1 << 1;
const I = 1 << 2;
const D = 1 << 3; // ignored on NES CPU
const B = 1 << 4;
const U = 1 << 5; // always 1
const V = 1 << 6;
const N = 1 << 7;

export class CPU6502 {
  state: CPUState;
  private nmiPending = false;
  private irqPending = false; // deprecated in favor of level-sensitive irqLine
  private irqLine = false;
  private jammed = false; // set when encountering JAM/KIL in strict mode
  private illegalMode: 'lenient' | 'strict' = 'lenient';
  // IRQ inhibit for CLI/SEI/PLP: delays IRQ service by one instruction
  private irqInhibitNext = false;
  // Track if we have a delayed IRQ from CLI that should fire once regardless of I flag
  private delayedIrqPending = false;
  // simple trace ring for debugging
  private tracePC: number[] = new Array(64).fill(0);
  private traceIdx = 0;
  // optional external per-instruction trace hook
  private traceHook: ((pc: number, opcode: number) => void) | null = null;
  // Debug tracing controls
  private spTraceEnabled = false;
  private spTraceStart = 0;
  private spTraceEnd = 0;
  private traceStackWritesEnabled = false;
  // Optional: trace when the top-of-stack (next RTS/RTI pull) matches a specific 16-bit value
  private traceStackTopMatch: number | null = null;
  // optional extra per-instruction hook (effective address, page-cross)
  private extraTraceHook: ((info: { pc: number, opcode: number, ea: number | null, crossed: boolean }) => void) | null = null;
  private lastEA: number | null = null;
  private lastCrossed = false;
  // Per-bus-access cycle hook for interleaving PPU/APU timing
  private cycleHook: ((cycles: number) => void) | null = null;
  // Count bus accesses during the current step (reads/writes/fetches)
  private busAccessCountCurr = 0;
  private lastBusAccessCount = 0;
  constructor(private bus: CPUBus) {
    this.state = { a: 0, x: 0, y: 0, s: 0xfd, pc: 0, p: 0x24, cycles: 0 };
    // Parse SP/stack tracing env once
    try {
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      if (env && typeof env.TRACE_SP_WINDOW === 'string' && env.TRACE_SP_WINDOW.length > 0) {
        const m = /^(0x)?([0-9a-fA-F]+)-(0x)?([0-9a-fA-F]+)$/.exec(env.TRACE_SP_WINDOW);
        if (m) {
          const a = parseInt(m[2], 16) & 0xFFFF;
          const b = parseInt(m[4], 16) & 0xFFFF;
          this.spTraceStart = Math.min(a, b);
          this.spTraceEnd = Math.max(a, b);
          this.spTraceEnabled = true;
        }
      }
      if (env && env.TRACE_STACK_WRITES === '1') this.traceStackWritesEnabled = true;
      // Optional: parse TRACE_STACK_TOP_MATCH (hex 16-bit) to log when top-of-stack equals this return address
      try {
        const matchStr = env?.TRACE_STACK_TOP_MATCH as string | undefined;
        if (matchStr && matchStr.length > 0) {
          const v = parseInt(matchStr, 16) & 0xFFFF;
          this.traceStackTopMatch = v;
        }
      } catch {}
    } catch {}
  }

  // Enable/disable a per-instruction trace callback (for harness debugging)
  setTraceHook(fn: ((pc: number, opcode: number) => void) | null) { this.traceHook = fn; }
  // Optional extra trace (effective address, page-cross)
  setExtraTraceHook(fn: ((info: { pc: number, opcode: number, ea: number | null, crossed: boolean }) => void) | null) { this.extraTraceHook = fn; }
  // Read back a copy of the recent PC ring (oldest->newest), up to count entries
  getRecentPCs(count = 16): number[] {
    const n = Math.min(count, this.tracePC.length, this.traceIdx);
    const out: number[] = [];
    for (let i = this.traceIdx - n; i < this.traceIdx; i++) {
      out.push(this.tracePC[i & 63]);
    }
    return out;
  }

  reset(vector: Word) {
    this.state = { a: 0, x: 0, y: 0, s: 0xfd, pc: vector & 0xffff, p: 0x24, cycles: 0 };
    this.nmiPending = false; this.irqPending = false; this.jammed = false;
    this.irqInhibitNext = false;
    this.delayedIrqPending = false;
  }

  // Configure behavior for unofficial KIL/JAM opcodes
  setIllegalMode(mode: 'lenient' | 'strict') { this.illegalMode = mode; }

  requestNMI() { this.nmiPending = true; }
  requestIRQ() { this.irqLine = true; }
  setIrqLine(level: boolean) { this.irqLine = !!level; }
  addCycles(n: number) { this.state.cycles += n; }
  // External: set per-cycle hook used to interleave PPU/APU ticks during memory accesses
  setCycleHook(fn: ((cycles: number) => void) | null) { this.cycleHook = fn; }
  // Expose the last step's bus access count (for scheduler to tick remaining internal cycles)
  getLastBusAccessCount(): number { return this.lastBusAccessCount; }

  // BRK return push delta: 1 => push PC+2 (correct 6502), 0 => push PC+1 (simplified test mode)
  private brkPushDelta: 0 | 1 = 1;
  public setBrkReturnMode(mode: 'pc+2' | 'pc+1') { this.brkPushDelta = (mode === 'pc+2') ? 1 : 0; }

  // Increment CPU cycles and tick external hook (PPU/APU) inline
  private incCycle(n: number = 1) {
    if (n <= 0) return;
    this.state.cycles += n;
    if (this.cycleHook) { try { this.cycleHook(n); } catch {} }
  }

  // Memory helpers (each bus access consumes one CPU cycle)
  private read(addr: Word): Byte {
    const a = addr & 0xffff;
    const v = this.bus.read(a) & 0xff;
    // Optional targeted trace: reads of PPUSTATUS ($2002 mirrors)
    try {
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      if (env && env.TRACE_2002_READS === '1') {
        if (a >= 0x2000 && a < 0x4000 && ((a & 0x7) === 2)) {
          let inWin = true;
          const win = env.TRACE_2002_WINDOW as string | undefined;
          if (win) {
            const m = /^(\d+)-(\d+)$/.exec(win);
            if (m) {
              const aa = parseInt(m[1], 10) | 0;
              const bb = parseInt(m[2], 10) | 0;
              const cyc = this.state.cycles | 0;
              inWin = (cyc >= aa && cyc <= bb);
            }
          }
          if (inWin) {
            // eslint-disable-next-line no-console
            console.log(`[cpu] read $2002 => $${v.toString(16).padStart(2,'0')} at pc=$${this.state.pc.toString(16).padStart(4,'0')} cycles=${this.state.cycles}`);
          }
        }
      }
    } catch {}
    this.busAccessCountCurr++;
    this.incCycle(1);
    return v;
  }
  private write(addr: Word, v: Byte): void {
    const a16 = addr & 0xffff;
    this.bus.write(a16, v & 0xff);
    if (this.traceStackWritesEnabled && ((a16 & 0xFF00) === 0x0100)) {
      const pc = this.state.pc & 0xFFFF;
      if (!this.spTraceEnabled || (pc >= this.spTraceStart && pc <= this.spTraceEnd)) {
        try { /* eslint-disable no-console */ console.log(`[stackwr] PC=$${pc.toString(16).padStart(4,'0')} [$${a16.toString(16).padStart(4,'0')}] <= $${(v & 0xFF).toString(16).padStart(2,'0')}`); /* eslint-enable no-console */ } catch {}
      }
    }
    this.busAccessCountCurr++;
    this.incCycle(1);
    // Optional targeted write trace within a cycles window
    try {
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      const win = env?.TRACE_WRITE_WINDOW as string | undefined;
      const addrFilter = env?.TRACE_WRITE_ADDRS as string | undefined; // comma-separated hex addresses like "4015,4017"
      if (win) {
        const m = /^(\d+)-(\d+)$/.exec(win);
        if (m) {
          const a = parseInt(m[1], 10) | 0;
          const b = parseInt(m[2], 10) | 0;
          const cyc = this.state.cycles | 0;
          if (cyc >= a && cyc <= b) {
            let okay = true;
            if (addrFilter) {
              const set = new Set(addrFilter.split(',').map(s => parseInt(s.trim(), 16) & 0xFFFF));
              okay = set.has(addr & 0xFFFF);
            }
            if (okay) {
              // eslint-disable-next-line no-console
              console.log(`[cpu] write $${(addr & 0xFFFF).toString(16).padStart(4,'0')} <= $${(v & 0xFF).toString(16).padStart(2,'0')} at cyc=${cyc}`);
            }
          }
        }
      }
    } catch {}
  }
  private read16(addr: Word): Word {
    const lo = this.read(addr);
    const hi = this.read((addr + 1) & 0xffff);
    return lo | (hi << 8);
  }

  private fetch8(): Byte {
    const v = this.read(this.state.pc);
    this.state.pc = (this.state.pc + 1) & 0xffff;
    return v;
  }
  private fetch16(): Word {
    const lo = this.fetch8();
    const hi = this.fetch8();
    return lo | (hi << 8);
  }

  private interrupt(vector: Word) {
    // Push PC and P (with B cleared, U set), set I
    const pc = this.state.pc;
    this.push16(pc);            // 2 bus cycles (accounted via read/write hooks)
    this.push8((this.state.p & ~(B)) | U); // 1 bus cycle
    this.setFlag(I, true);
    this.state.pc = vector & 0xffff;
    // Read vector consumes 2 bus cycles in caller (serviceInterrupts via read16),
    // plus 2 internal cycles to reach total of 7 cycles for interrupt sequence.
    this.incCycle(2);
  }

  private push8(v: Byte) {
    this.write(0x0100 + this.state.s, v);
    this.state.s = (this.state.s - 1) & 0xff;
  }
  private pop8(): Byte {
    this.state.s = (this.state.s + 1) & 0xff;
    return this.read(0x0100 + this.state.s);
  }
  private push16(v: Word) {
    this.push8((v >>> 8) & 0xff);
    this.push8(v & 0xff);
  }
  private pop16(): Word {
    const lo = this.pop8();
    const hi = this.pop8();
    return lo | (hi << 8);
  }

  private setZN(v: Byte) {
    const p = this.state.p;
    this.state.p = (p & ~(Z | N)) | (v === 0 ? Z : 0) | (v & 0x80);
  }
  private getFlag(mask: number): boolean { return (this.state.p & mask) !== 0; }
  private setFlag(mask: number, val: boolean) {
    const before = this.state.p;
    this.state.p = (before & ~mask) | (val ? mask : 0);
    // Optional tracing: log I-flag transitions with cycle count for debugging IRQ latency
    try {
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      if (env && env.TRACE_I_CHANGES === '1' && mask === I) {
        const prevI = (before & I) !== 0;
        const newI = (this.state.p & I) !== 0;
        if (prevI !== newI) {
          // eslint-disable-next-line no-console
          console.log(`[cpu] I change ${prevI ? '1->0' : '0->1'} at cycles=${this.state.cycles}`);
        }
      }
    } catch {}
  }

  // --- Helpers for RMW illegal opcodes ---
  private aslByte(v: Byte): Byte {
    const c = (v & 0x80) !== 0;
    const r = (v << 1) & 0xff;
    this.setFlag(C, c);
    return r;
  }
  private lsrByte(v: Byte): Byte {
    const c = (v & 0x01) !== 0;
    const r = (v >>> 1) & 0xff;
    this.setFlag(C, c);
    return r;
  }
  private rolByte(v: Byte): Byte {
    const oldC = this.getFlag(C);
    const newC = (v & 0x80) !== 0;
    const r = ((v << 1) | (oldC ? 1 : 0)) & 0xff;
    this.setFlag(C, newC);
    return r;
  }
  private rorByte(v: Byte): Byte {
    const oldC = this.getFlag(C);
    const newC = (v & 0x01) !== 0;
    const r = ((v >>> 1) | (oldC ? 0x80 : 0)) & 0xff;
    this.setFlag(C, newC);
    return r;
  }

  // Addressing modes return {addr?, value?, crossed?}
  private adrIMM() { return { value: this.fetch8(), crossed: false }; }
  private adrZP() { const addr = this.fetch8(); this.lastEA = addr; this.lastCrossed = false; return { addr, crossed: false }; }
  private adrZPX() { const addr = (this.fetch8() + this.state.x) & 0xff; this.lastEA = addr; this.lastCrossed = false; return { addr, crossed: false }; }
  private adrZPY() { const addr = (this.fetch8() + this.state.y) & 0xff; this.lastEA = addr; this.lastCrossed = false; return { addr, crossed: false }; }
  private adrABS() { const addr = this.fetch16(); this.lastEA = addr; this.lastCrossed = false; return { addr, crossed: false }; }
  private adrABSX() {
    const base = this.fetch16();
    const addr = (base + this.state.x) & 0xffff;
    const crossed = (base & 0xff00) !== (addr & 0xff00);
    this.lastEA = addr; this.lastCrossed = crossed;
    return { addr, crossed };
  }
  private adrABSY() {
    const base = this.fetch16();
    const addr = (base + this.state.y) & 0xffff;
    const crossed = (base & 0xff00) !== (addr & 0xff00);
    this.lastEA = addr; this.lastCrossed = crossed;
    return { addr, crossed };
  }
  private adrIND() {
    // 6502 JMP indirect bug emulation
    const ptr = this.fetch16();
    const lo = this.read(ptr);
    const hiAddr = (ptr & 0xff00) | ((ptr + 1) & 0x00ff);
    const hi = this.read(hiAddr);
    const addr = lo | (hi << 8);
    this.lastEA = addr; this.lastCrossed = false;
    return { addr, crossed: false };
  }
  private adrINDX() {
    const zp = (this.fetch8() + this.state.x) & 0xff;
    const lo = this.read(zp);
    const hi = this.read((zp + 1) & 0xff);
    const addr = lo | (hi << 8);
    this.lastEA = addr; this.lastCrossed = false;
    return { addr, crossed: false };
  }
  private adrINDY() {
    const zp = this.fetch8();
    const lo = this.read(zp);
    const hi = this.read((zp + 1) & 0xff);
    const base = lo | (hi << 8);
    const addr = (base + this.state.y) & 0xffff;
    const crossed = (base & 0xff00) !== (addr & 0xff00);
    this.lastEA = addr; this.lastCrossed = crossed;
    return { addr, crossed };
  }

  private adc(val: Byte) {
    const a = this.state.a;
    const c = this.getFlag(C) ? 1 : 0;
    const sum = a + val + c;
    const result = sum & 0xff;
    this.setFlag(C, sum > 0xff);
    const overflow = (~(a ^ val) & (a ^ result) & 0x80) !== 0;
    this.setFlag(V, overflow);
    this.state.a = result;
    this.setZN(this.state.a);
  }
  private cmp(reg: Byte, val: Byte) {
    const t = (reg - val) & 0xff;
    this.setFlag(C, reg >= val);
    this.setZN(t);
  }
  private sbc(val: Byte) {
    // NES in binary mode: A = A - val - (1-C)
    this.adc((val ^ 0xff) & 0xff);
  }

  private serviceInterrupts() {
    if (this.nmiPending) {
      this.nmiPending = false;
      const vec = this.read16(0xfffa);
      try {
        const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
        if (env && env.TRACE_IRQ_VECTOR === '1') {
          // eslint-disable-next-line no-console
          console.log(`[cpu] NMI vector taken pc=$${this.state.pc.toString(16).padStart(4,'0')} cycles=${this.state.cycles} p=$${this.state.p.toString(16).padStart(2,'0')}`);
        }
      } catch {}
      this.interrupt(vec);
      return true;
    }
    // Check if we have a delayed IRQ from CLI that should fire once regardless of I flag
    if (this.delayedIrqPending) {
      this.delayedIrqPending = false;
      const vec = this.read16(0xfffe);
      try {
        const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
        if (env && env.TRACE_IRQ_VECTOR === '1') {
          // eslint-disable-next-line no-console
          console.log(`[cpu] IRQ vector taken (delayed from CLI) pc=$${this.state.pc.toString(16).padStart(4,'0')} cycles=${this.state.cycles} p=$${this.state.p.toString(16).padStart(2,'0')}`);
        }
      } catch {}
      this.interrupt(vec);
      return true;
    }
    // Check if IRQ should be serviced normally
    if (this.irqLine && !this.getFlag(I)) {
      const vec = this.read16(0xfffe);
      try {
        const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
        if (env && env.TRACE_IRQ_VECTOR === '1') {
          // eslint-disable-next-line no-console
          console.log(`[cpu] IRQ vector taken (normal) pc=$${this.state.pc.toString(16).padStart(4,'0')} cycles=${this.state.cycles} p=$${this.state.p.toString(16).padStart(2,'0')}`);
        }
      } catch {}
      this.interrupt(vec);
      return true;
    }
    // Optional: log when IRQ line is asserted but masked by I=1 (no latency override), within a cycles window
    try {
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      const win = env?.TRACE_IRQ_MASKED_WINDOW as string | undefined;
      if (win && this.irqLine && this.getFlag(I)) {
        const m = /^(\d+)-(\d+)$/.exec(win);
        if (m) {
          const a = parseInt(m[1], 10) | 0;
          const b = parseInt(m[2], 10) | 0;
          const cyc = this.state.cycles | 0;
          if (cyc >= a && cyc <= b) {
            // eslint-disable-next-line no-console
            console.log(`[cpu] IRQ masked (I=1) pc=$${this.state.pc.toString(16).padStart(4,'0')} cycles=${cyc} p=$${this.state.p.toString(16).padStart(2,'0')}`);
          }
        }
      }
    } catch {}
    return false;
  }

  step(): void {
    // If jammed (strict KIL), halt execution (no further cycles progress)
    if (this.jammed) return;

    const cycBeforeInstr = this.state.cycles | 0;

    // Optional: lightweight PC/opcode trace within a cycles window for debugging
    let traceThisInstr = false;
    try {
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      const win = env?.TRACE_PC_WINDOW as string | undefined;
      if (win) {
        const m = /^(\d+)-(\d+)$/.exec(win);
        if (m) {
          const a = parseInt(m[1], 10) | 0;
          const b = parseInt(m[2], 10) | 0;
          const cyc = this.state.cycles | 0;
          traceThisInstr = (cyc >= a && cyc <= b);
        }
      }
    } catch {}

    // Strict JAM/KIL prefetch: peek opcode without consuming a cycle. If it's KIL and strict, jam immediately.
    const opPeek = this.bus.read(this.state.pc) & 0xFF; // direct bus read: no cycle cost
    if (this.illegalMode === 'strict') {
      switch (opPeek) {
        case 0x02: case 0x12: case 0x22: case 0x32: case 0x42: case 0x52: case 0x62: case 0x72: case 0x92: case 0xB2: case 0xD2: case 0xF2:
          this.jammed = true; return;
      }
    }

    // Optional: pre-decision IRQ/NMI trace at instruction boundary
    try {
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      if (env && env.TRACE_IRQ_DECISION === '1') {
        let inWindow = true;
        const win = env.TRACE_DECISION_WINDOW as string | undefined;
        if (win) {
          const m = /^(\d+)-(\d+)$/.exec(win);
          if (m) {
            const a = parseInt(m[1], 10) | 0;
            const b = parseInt(m[2], 10) | 0;
            const cyc = this.state.cycles | 0;
            inWindow = (cyc >= a && cyc <= b);
          }
        }
        if (inWindow) {
          const iFlag = this.getFlag(I);
          const line = this.irqLine;
          const inhibit = this.irqInhibitNext;
          let decision = 'no-irq';
          if (this.nmiPending) {
            decision = 'nmi';
          } else if (inhibit && line) {
            decision = 'irq-inhibited';
          } else if (line && !iFlag) {
            decision = 'irq-normal';
          } else if (line && iFlag) {
            decision = 'irq-masked';
          }
          // eslint-disable-next-line no-console
          console.log(`[cpu] IRQ decision pc=$${this.state.pc.toString(16).padStart(4,'0')} cycles=${this.state.cycles} I=${iFlag?1:0} line=${line?1:0} inhibit=${inhibit?1:0} -> ${decision}`);
        }
      }
    } catch {}

    // Service interrupts between instructions (unless inhibited)
    if (!this.irqInhibitNext && this.serviceInterrupts()) return;
    
    // Clear the inhibit flag after the check
    this.irqInhibitNext = false;

    const pcBefore = this.state.pc;
    // Optional SP trace (pre)
    if (this.spTraceEnabled) {
      const pcv = pcBefore & 0xFFFF;
      if (pcv >= this.spTraceStart && pcv <= this.spTraceEnd) {
        try { /* eslint-disable no-console */ console.log(`[sp] pre  PC=$${pcv.toString(16).padStart(4,'0')} SP=$${this.state.s.toString(16).padStart(2,'0')} P=$${this.state.p.toString(16).padStart(2,'0')} A=$${this.state.a.toString(16).padStart(2,'0')} X=$${this.state.x.toString(16).padStart(2,'0')} Y=$${this.state.y.toString(16).padStart(2,'0')}`); /* eslint-enable no-console */ } catch {}
      }
    }
    // reset per-step bus access counter
    this.busAccessCountCurr = 0;
    this.lastEA = null; this.lastCrossed = false;
    // record every step
    this.tracePC[this.traceIdx & 63] = pcBefore;
    this.traceIdx++;
    const opcode = this.fetch8();
    // optional external tracing
    if (traceThisInstr) {
      try {
        // eslint-disable-next-line no-console
        console.log(`[trace] pc=$${pcBefore.toString(16).padStart(4,'0')} op=$${opcode.toString(16).padStart(2,'0')} p=$${this.state.p.toString(16).padStart(2,'0')} cyc=${this.state.cycles}`);
      } catch {}
    }
    if (this.traceHook) { try { this.traceHook(pcBefore, opcode); } catch {} }
    // Base cycles table for implemented opcodes
    const s = this.state;
    let base = 0; // base cycles for this instruction (includes bus + internal)
    switch (opcode) {
      // NOP
      case 0xEA: base += 2; break;
      // LDA
      case 0xA9: { const { value } = this.adrIMM(); s.a = value!; this.setZN(s.a); base += 2; break; }
      case 0xA5: { const { addr } = this.adrZP(); s.a = this.read(addr!); this.setZN(s.a); base += 3; break; }
      case 0xB5: { const { addr } = this.adrZPX(); s.a = this.read(addr!); this.setZN(s.a); base += 4; break; }
      case 0xAD: { const { addr } = this.adrABS(); s.a = this.read(addr!); this.setZN(s.a); base += 4; break; }
      case 0xBD: { const { addr, crossed } = this.adrABSX(); s.a = this.read(addr!); this.setZN(s.a); base += 4 + (crossed ? 1 : 0); break; }
      case 0xB9: { const { addr, crossed } = this.adrABSY(); s.a = this.read(addr!); this.setZN(s.a); base += 4 + (crossed ? 1 : 0); break; }
      case 0xA1: { const { addr } = this.adrINDX(); s.a = this.read(addr!); this.setZN(s.a); base += 6; break; }
      case 0xB1: { const { addr, crossed } = this.adrINDY(); s.a = this.read(addr!); this.setZN(s.a); base += 5 + (crossed ? 1 : 0); break; }
      // LDX
      case 0xA2: { const { value } = this.adrIMM(); s.x = value!; this.setZN(s.x); base += 2; break; }
      case 0xA6: { const { addr } = this.adrZP(); s.x = this.read(addr!); this.setZN(s.x); base += 3; break; }
      case 0xB6: { const { addr } = this.adrZPY(); s.x = this.read(addr!); this.setZN(s.x); base += 4; break; }
      case 0xAE: { const { addr } = this.adrABS(); s.x = this.read(addr!); this.setZN(s.x); base += 4; break; }
      case 0xBE: { const { addr, crossed } = this.adrABSY(); s.x = this.read(addr!); this.setZN(s.x); base += 4 + (crossed ? 1 : 0); break; }
      // LDY
      case 0xA0: { const { value } = this.adrIMM(); s.y = value!; this.setZN(s.y); base += 2; break; }
      case 0xA4: { const { addr } = this.adrZP(); s.y = this.read(addr!); this.setZN(s.y); base += 3; break; }
      case 0xB4: { const { addr } = this.adrZPX(); s.y = this.read(addr!); this.setZN(s.y); base += 4; break; }
      case 0xAC: { const { addr } = this.adrABS(); s.y = this.read(addr!); this.setZN(s.y); base += 4; break; }
      case 0xBC: { const { addr, crossed } = this.adrABSX(); s.y = this.read(addr!); this.setZN(s.y); base += 4 + (crossed ? 1 : 0); break; }
      // STA
      case 0x85: { const { addr } = this.adrZP(); this.write(addr!, s.a); base += 3; break; }
      case 0x95: { const { addr } = this.adrZPX(); this.write(addr!, s.a); base += 4; break; }
      case 0x8D: { const { addr } = this.adrABS(); this.write(addr!, s.a); base += 4; break; }
      case 0x9D: { const { addr } = this.adrABSX(); this.write(addr!, s.a); base += 5; break; }
      case 0x99: { const { addr } = this.adrABSY(); this.write(addr!, s.a); base += 5; break; }
      case 0x81: { const { addr } = this.adrINDX(); this.write(addr!, s.a); base += 6; break; }
      case 0x91: { const { addr } = this.adrINDY(); this.write(addr!, s.a); base += 6; break; }
      // Unofficial: SAX (store A & X)
      case 0x87: { const { addr } = this.adrZP(); this.write(addr!, s.a & s.x); base += 3; break; }      // SAX zp
      case 0x97: { const { addr } = this.adrZPY(); this.write(addr!, s.a & s.x); base += 4; break; }     // SAX zp,Y
      case 0x8F: { const { addr } = this.adrABS(); this.write(addr!, s.a & s.x); base += 4; break; }      // SAX abs
      case 0x83: { const { addr } = this.adrINDX(); this.write(addr!, s.a & s.x); base += 6; break; }     // SAX (zp,X)
      // STX
      case 0x86: { const { addr } = this.adrZP(); this.write(addr!, s.x); base += 3; break; }
      case 0x96: { const { addr } = this.adrZPY(); this.write(addr!, s.x); base += 4; break; }
      case 0x8E: { const { addr } = this.adrABS(); this.write(addr!, s.x); base += 4; break; }
      // STY
      case 0x84: { const { addr } = this.adrZP(); this.write(addr!, s.y); base += 3; break; }
      case 0x94: { const { addr } = this.adrZPX(); this.write(addr!, s.y); base += 4; break; }
      case 0x8C: { const { addr } = this.adrABS(); this.write(addr!, s.y); base += 4; break; }
      // Transfers
      case 0xAA: s.x = s.a; this.setZN(s.x); base += 2; break; // TAX
      case 0xA8: s.y = s.a; this.setZN(s.y); base += 2; break; // TAY
      case 0x8A: s.a = s.x; this.setZN(s.a); base += 2; break; // TXA
      case 0x98: s.a = s.y; this.setZN(s.a); base += 2; break; // TYA
      case 0xBA: s.x = s.s; this.setZN(s.x); base += 2; break; // TSX
      case 0x9A: s.s = s.x; /* no flags */ base += 2; break; // TXS
      // Stack
      case 0x48: this.push8(s.a); base += 3; break; // PHA
      case 0x68: s.a = this.pop8(); this.setZN(s.a); base += 4; break; // PLA
      case 0x08: this.push8((s.p | U | B) & 0xff); base += 3; break; // PHP
      case 0x28: { 
        const prevI = this.getFlag(I);
        s.p = (this.pop8() & ~B) | U; 
        const newI = (s.p & I) !== 0;
        // If I changed from 1 to 0 (cleared), and IRQ line is active, delay the IRQ by one instruction
        if (prevI && !newI && this.irqLine) {
          this.irqInhibitNext = true;
          this.delayedIrqPending = true;
        }
        base += 4; 
        break; 
      } // PLP
      // AND/ORA/EOR
      // AND
      case 0x29: { const { value } = this.adrIMM(); s.a = s.a & value!; this.setZN(s.a); base += 2; break; }
      case 0x25: { const { addr } = this.adrZP(); s.a = s.a & this.read(addr!); this.setZN(s.a); base += 3; break; }
      case 0x35: { const { addr } = this.adrZPX(); s.a = s.a & this.read(addr!); this.setZN(s.a); base += 4; break; }
      case 0x2D: { const { addr } = this.adrABS(); s.a = s.a & this.read(addr!); this.setZN(s.a); base += 4; break; }
      case 0x3D: { const { addr, crossed } = this.adrABSX(); s.a = s.a & this.read(addr!); this.setZN(s.a); base += 4 + (crossed ? 1 : 0); break; }
      case 0x39: { const { addr, crossed } = this.adrABSY(); s.a = s.a & this.read(addr!); this.setZN(s.a); base += 4 + (crossed ? 1 : 0); break; }
      case 0x21: { const { addr } = this.adrINDX(); s.a = s.a & this.read(addr!); this.setZN(s.a); base += 6; break; }
      case 0x31: { const { addr, crossed } = this.adrINDY(); s.a = s.a & this.read(addr!); this.setZN(s.a); base += 5 + (crossed ? 1 : 0); break; }
      // ORA
      case 0x09: { const { value } = this.adrIMM(); s.a = s.a | value!; this.setZN(s.a); base += 2; break; }
      case 0x05: { const { addr } = this.adrZP(); s.a = s.a | this.read(addr!); this.setZN(s.a); base += 3; break; }
      case 0x15: { const { addr } = this.adrZPX(); s.a = s.a | this.read(addr!); this.setZN(s.a); base += 4; break; }
      case 0x0D: { const { addr } = this.adrABS(); s.a = s.a | this.read(addr!); this.setZN(s.a); base += 4; break; }
      case 0x1D: { const { addr, crossed } = this.adrABSX(); s.a = s.a | this.read(addr!); this.setZN(s.a); base += 4 + (crossed ? 1 : 0); break; }
      case 0x19: { const { addr, crossed } = this.adrABSY(); s.a = s.a | this.read(addr!); this.setZN(s.a); base += 4 + (crossed ? 1 : 0); break; }
      case 0x01: { const { addr } = this.adrINDX(); s.a = s.a | this.read(addr!); this.setZN(s.a); base += 6; break; }
      case 0x11: { const { addr, crossed } = this.adrINDY(); s.a = s.a | this.read(addr!); this.setZN(s.a); base += 5 + (crossed ? 1 : 0); break; }
      
      // Unofficial: LAX (load A and X) - behaves like LDA then TAX
      case 0xA7: { const { addr } = this.adrZP(); const v = this.read(addr!); s.a = v; s.x = v; this.setZN(v); base += 3; break; }      // LAX zp
      // Unofficial: LAS abs,Y (0xBB): A,X,S = (mem & S); flags from A; cycles like LDA abs,Y
      case 0xBB: { const { addr, crossed } = this.adrABSY(); const m = this.read(addr!); const val = m & s.s; s.a = val; s.x = val; s.s = val; this.setZN(s.a); base += 4 + (crossed ? 1 : 0); break; }
      case 0xB7: { const { addr } = this.adrZPY(); const v = this.read(addr!); s.a = v; s.x = v; this.setZN(v); base += 4; break; }     // LAX zp,Y
      case 0xAF: { const { addr } = this.adrABS(); const v = this.read(addr!); s.a = v; s.x = v; this.setZN(v); base += 4; break; }      // LAX abs
      case 0xBF: { const { addr, crossed } = this.adrABSY(); const v = this.read(addr!); s.a = v; s.x = v; this.setZN(v); base += 4 + (crossed ? 1 : 0); break; } // LAX abs,Y
      case 0xA3: { const { addr } = this.adrINDX(); const v = this.read(addr!); s.a = v; s.x = v; this.setZN(v); base += 6; break; }    // LAX (zp,X)
      case 0xB3: { const { addr, crossed } = this.adrINDY(); const v = this.read(addr!); s.a = v; s.x = v; this.setZN(v); base += 5 + (crossed ? 1 : 0); break; } // LAX (zp),Y
      case 0xAB: { const { value } = this.adrIMM(); const v = value!; s.a = v; s.x = v; this.setZN(v); base += 2; break; }             // LAX #imm (unstable, but enough for tests)
      // EOR
      case 0x49: { const { value } = this.adrIMM(); s.a = s.a ^ value!; this.setZN(s.a); base += 2; break; }
      case 0x45: { const { addr } = this.adrZP(); s.a = s.a ^ this.read(addr!); this.setZN(s.a); base += 3; break; }
      case 0x55: { const { addr } = this.adrZPX(); s.a = s.a ^ this.read(addr!); this.setZN(s.a); base += 4; break; }
      case 0x4D: { const { addr } = this.adrABS(); s.a = s.a ^ this.read(addr!); this.setZN(s.a); base += 4; break; }
      case 0x5D: { const { addr, crossed } = this.adrABSX(); s.a = s.a ^ this.read(addr!); this.setZN(s.a); base += 4 + (crossed ? 1 : 0); break; }
      case 0x59: { const { addr, crossed } = this.adrABSY(); s.a = s.a ^ this.read(addr!); this.setZN(s.a); base += 4 + (crossed ? 1 : 0); break; }
      case 0x41: { const { addr } = this.adrINDX(); s.a = s.a ^ this.read(addr!); this.setZN(s.a); base += 6; break; }
      case 0x51: { const { addr, crossed } = this.adrINDY(); s.a = s.a ^ this.read(addr!); this.setZN(s.a); base += 5 + (crossed ? 1 : 0); break; }
      // ADC/SBC
      // Unofficial: ANC (#imm) = AND then C = bit7(A)
      case 0x0B: case 0x2B: { const { value } = this.adrIMM(); s.a = s.a & value!; this.setZN(s.a); this.setFlag(C, (s.a & 0x80) !== 0); base += 2; break; }
      case 0x69: { const { value } = this.adrIMM(); this.adc(value!); base += 2; break; }
      case 0x65: { const { addr } = this.adrZP(); this.adc(this.read(addr!)); base += 3; break; }
      case 0x75: { const { addr } = this.adrZPX(); this.adc(this.read(addr!)); base += 4; break; }
      case 0x6D: { const { addr } = this.adrABS(); this.adc(this.read(addr!)); base += 4; break; }
      case 0x7D: { const { addr, crossed } = this.adrABSX(); this.adc(this.read(addr!)); base += 4 + (crossed ? 1 : 0); break; }
      case 0x79: { const { addr, crossed } = this.adrABSY(); this.adc(this.read(addr!)); base += 4 + (crossed ? 1 : 0); break; }
      case 0x61: { const { addr } = this.adrINDX(); this.adc(this.read(addr!)); base += 6; break; }
      case 0x71: { const { addr, crossed } = this.adrINDY(); this.adc(this.read(addr!)); base += 5 + (crossed ? 1 : 0); break; }
      case 0xE9: case 0xEB: { const { value } = this.adrIMM(); this.sbc(value!); base += 2; break; }
      case 0xE5: { const { addr } = this.adrZP(); this.sbc(this.read(addr!)); base += 3; break; }
      case 0xF5: { const { addr } = this.adrZPX(); this.sbc(this.read(addr!)); base += 4; break; }
      case 0xED: { const { addr } = this.adrABS(); this.sbc(this.read(addr!)); base += 4; break; }
      case 0xFD: { const { addr, crossed } = this.adrABSX(); this.sbc(this.read(addr!)); base += 4 + (crossed ? 1 : 0); break; }
      case 0xF9: { const { addr, crossed } = this.adrABSY(); this.sbc(this.read(addr!)); base += 4 + (crossed ? 1 : 0); break; }
      case 0xE1: { const { addr } = this.adrINDX(); this.sbc(this.read(addr!)); base += 6; break; }
      case 0xF1: { const { addr, crossed } = this.adrINDY(); this.sbc(this.read(addr!)); base += 5 + (crossed ? 1 : 0); break; }
      
      // INC/DEC
      case 0xE6: { const { addr } = this.adrZP(); const v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.setZN(v); base += 5; break; }
      case 0xF6: { const { addr } = this.adrZPX(); const v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.setZN(v); base += 6; break; }
      case 0xEE: { const { addr } = this.adrABS(); const v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.setZN(v); base += 6; break; }
      case 0xFE: { const { addr } = this.adrABSX(); const v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.setZN(v); base += 7; break; }
      case 0xC6: { const { addr } = this.adrZP(); const v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.setZN(v); base += 5; break; }
      case 0xD6: { const { addr } = this.adrZPX(); const v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.setZN(v); base += 6; break; }
      case 0xCE: { const { addr } = this.adrABS(); const v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.setZN(v); base += 6; break; }
      case 0xDE: { const { addr } = this.adrABSX(); const v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.setZN(v); base += 7; break; }
      case 0xE8: s.x = (s.x + 1) & 0xff; this.setZN(s.x); base += 2; break; // INX
      case 0xC8: s.y = (s.y + 1) & 0xff; this.setZN(s.y); base += 2; break; // INY
      case 0xCA: s.x = (s.x - 1) & 0xff; this.setZN(s.x); base += 2; break; // DEX
      case 0x88: s.y = (s.y - 1) & 0xff; this.setZN(s.y); base += 2; break; // DEY
      // Shifts/rotates (accumulator variants)
      // Unofficial: ALR (#imm) = AND then LSR (C from pre-shift bit0)
      case 0x4B: { const { value } = this.adrIMM(); let t = s.a & value!; const c0 = (t & 1) !== 0; t = (t >>> 1) & 0xff; s.a = t; this.setFlag(C, c0); this.setZN(s.a); base += 2; break; }
      // Unofficial: ARR (#imm) = AND then ROR A (sets V and C specially)
      case 0x6B: { const { value } = this.adrIMM(); const oldC = this.getFlag(C); let t = s.a & value!; let r = ((t >>> 1) | (oldC ? 0x80 : 0)) & 0xff; s.a = r; this.setZN(s.a); this.setFlag(C, (r & 0x40) !== 0); this.setFlag(V, ((r ^ ((r << 1) & 0xff)) & 0x40) !== 0); base += 2; break; }
      case 0x0A: { const c = (s.a & 0x80) !== 0; s.a = (s.a << 1) & 0xff; this.setFlag(C, c); this.setZN(s.a); base += 2; break; } // ASL A
      case 0x4A: { const c = (s.a & 0x01) !== 0; s.a = (s.a >>> 1) & 0xff; this.setFlag(C, c); this.setZN(s.a); base += 2; break; } // LSR A
      case 0x2A: { const c = this.getFlag(C); const newC = (s.a & 0x80) !== 0; s.a = ((s.a << 1) | (c ? 1 : 0)) & 0xff; this.setFlag(C, newC); this.setZN(s.a); base += 2; break; } // ROL A
      case 0x6A: { const c = this.getFlag(C); const newC = (s.a & 0x01) !== 0; s.a = ((s.a >>> 1) | (c ? 0x80 : 0)) & 0xff; this.setFlag(C, newC); this.setZN(s.a); base += 2; break; } // ROR A
      // Shifts/rotates (memory variants)
      case 0x06: { const { addr } = this.adrZP(); let v = this.read(addr!); const c = (v & 0x80) !== 0; v = (v << 1) & 0xff; this.write(addr!, v); this.setFlag(C, c); this.setZN(v); base += 5; break; } // ASL zp
      
      // --- Unofficial stores involving address-high+1 masking (mask from BASE high byte, not effective) ---
      // SHY/SYA (0x9C) abs,X: store (Y & (high(base)+1)); address uses base page (ignore carry)
      case 0x9C: {
        const baseAddr = this.fetch16();
        const lo = (baseAddr & 0xFF);
        const hi = (baseAddr >>> 8) & 0xFF;
        const effLo = (lo + s.x) & 0xFF; // ignore carry into high
        const addr = ((hi << 8) | effLo) & 0xFFFF;
        const highMask = ((hi + 1) & 0xFF);
        const val = s.y & highMask;
        this.write(addr, val);
        base += 5;
        break;
      }
      // SHX/SXA (0x9E) abs,Y: store (X & (high(base)+1)); address uses base page (ignore carry)
      case 0x9E: {
        const baseAddr = this.fetch16();
        const lo = (baseAddr & 0xFF);
        const hi = (baseAddr >>> 8) & 0xFF;
        const effLo = (lo + s.y) & 0xFF; // ignore carry into high
        const addr = ((hi << 8) | effLo) & 0xFFFF;
        const highMask = ((hi + 1) & 0xFF);
        const val = s.x & highMask;
        this.write(addr, val);
        base += 5;
        break;
      }
      // TAS/SHS (0x9B) abs,Y: S = A & X; store (S & (high(base)+1)); address uses base page (ignore carry)
      case 0x9B: {
        const baseAddr = this.fetch16();
        const lo = (baseAddr & 0xFF);
        const hi = (baseAddr >>> 8) & 0xFF;
        const effLo = (lo + s.y) & 0xFF; // ignore carry into high
        const addr = ((hi << 8) | effLo) & 0xFFFF;
        s.s = s.a & s.x;
        const highMask = ((hi + 1) & 0xFF);
        const val = s.s & highMask;
        this.write(addr, val);
        base += 5;
        break;
      }
      // AHX/SHA (0x9F) abs,Y: store (A & X & (high(base)+1)); address uses base page (ignore carry)
      case 0x9F: {
        const baseAddr = this.fetch16();
        const lo = (baseAddr & 0xFF);
        const hi = (baseAddr >>> 8) & 0xFF;
        const effLo = (lo + s.y) & 0xFF; // ignore carry into high
        const addr = ((hi << 8) | effLo) & 0xFFFF;
        const highMask = ((hi + 1) & 0xFF);
        const val = s.a & s.x & highMask;
        this.write(addr, val);
        base += 5;
        break;
      }
      // AHX/SHA (0x93) (zp),Y: store (A & X & (high(base)+1)) at base+Y
      case 0x93: {
        const zp = this.fetch8();
        const lo = this.read(zp);
        const hi = this.read((zp + 1) & 0xFF);
        const basePtr = lo | (hi << 8);
        const addr = (basePtr + s.y) & 0xFFFF;
        const high = (((basePtr >> 8) & 0xFF) + 1) & 0xFF;
        const val = s.a & s.x & high;
        this.write(addr, val);
        base += 6;
        break;
      }
      case 0x16: { const { addr } = this.adrZPX(); let v = this.read(addr!); const c = (v & 0x80) !== 0; v = (v << 1) & 0xff; this.write(addr!, v); this.setFlag(C, c); this.setZN(v); base += 6; break; } // ASL zp,X
      case 0x0E: { const { addr } = this.adrABS(); let v = this.read(addr!); const c = (v & 0x80) !== 0; v = (v << 1) & 0xff; this.write(addr!, v); this.setFlag(C, c); this.setZN(v); base += 6; break; } // ASL abs
      case 0x1E: { const { addr } = this.adrABSX(); let v = this.read(addr!); const c = (v & 0x80) !== 0; v = (v << 1) & 0xff; this.write(addr!, v); this.setFlag(C, c); this.setZN(v); base += 7; break; } // ASL abs,X
      case 0x46: { const { addr } = this.adrZP(); let v = this.read(addr!); const c = (v & 0x01) !== 0; v = (v >>> 1) & 0xff; this.write(addr!, v); this.setFlag(C, c); this.setZN(v); base += 5; break; } // LSR zp
      case 0x56: { const { addr } = this.adrZPX(); let v = this.read(addr!); const c = (v & 0x01) !== 0; v = (v >>> 1) & 0xff; this.write(addr!, v); this.setFlag(C, c); this.setZN(v); base += 6; break; } // LSR zp,X
      case 0x4E: { const { addr } = this.adrABS(); let v = this.read(addr!); const c = (v & 0x01) !== 0; v = (v >>> 1) & 0xff; this.write(addr!, v); this.setFlag(C, c); this.setZN(v); base += 6; break; } // LSR abs
      case 0x5E: { const { addr } = this.adrABSX(); let v = this.read(addr!); const c = (v & 0x01) !== 0; v = (v >>> 1) & 0xff; this.write(addr!, v); this.setFlag(C, c); this.setZN(v); base += 7; break; } // LSR abs,X
      case 0x26: { const { addr } = this.adrZP(); let v = this.read(addr!); const oldC = this.getFlag(C); const newC = (v & 0x80) !== 0; v = ((v << 1) | (oldC ? 1 : 0)) & 0xff; this.write(addr!, v); this.setFlag(C, newC); this.setZN(v); base += 5; break; } // ROL zp
      case 0x36: { const { addr } = this.adrZPX(); let v = this.read(addr!); const oldC = this.getFlag(C); const newC = (v & 0x80) !== 0; v = ((v << 1) | (oldC ? 1 : 0)) & 0xff; this.write(addr!, v); this.setFlag(C, newC); this.setZN(v); base += 6; break; } // ROL zp,X
      case 0x2E: { const { addr } = this.adrABS(); let v = this.read(addr!); const oldC = this.getFlag(C); const newC = (v & 0x80) !== 0; v = ((v << 1) | (oldC ? 1 : 0)) & 0xff; this.write(addr!, v); this.setFlag(C, newC); this.setZN(v); base += 6; break; } // ROL abs
      case 0x3E: { const { addr } = this.adrABSX(); let v = this.read(addr!); const oldC = this.getFlag(C); const newC = (v & 0x80) !== 0; v = ((v << 1) | (oldC ? 1 : 0)) & 0xff; this.write(addr!, v); this.setFlag(C, newC); this.setZN(v); base += 7; break; } // ROL abs,X
      case 0x66: { const { addr } = this.adrZP(); let v = this.read(addr!); const oldC = this.getFlag(C); const newC = (v & 0x01) !== 0; v = ((v >>> 1) | (oldC ? 0x80 : 0)) & 0xff; this.write(addr!, v); this.setFlag(C, newC); this.setZN(v); base += 5; break; } // ROR zp
      case 0x76: { const { addr } = this.adrZPX(); let v = this.read(addr!); const oldC = this.getFlag(C); const newC = (v & 0x01) !== 0; v = ((v >>> 1) | (oldC ? 0x80 : 0)) & 0xff; this.write(addr!, v); this.setFlag(C, newC); this.setZN(v); base += 6; break; } // ROR zp,X
      case 0x6E: { const { addr } = this.adrABS(); let v = this.read(addr!); const oldC = this.getFlag(C); const newC = (v & 0x01) !== 0; v = ((v >>> 1) | (oldC ? 0x80 : 0)) & 0xff; this.write(addr!, v); this.setFlag(C, newC); this.setZN(v); base += 6; break; } // ROR abs
      case 0x7E: { const { addr } = this.adrABSX(); let v = this.read(addr!); const oldC = this.getFlag(C); const newC = (v & 0x01) !== 0; v = ((v >>> 1) | (oldC ? 0x80 : 0)) & 0xff; this.write(addr!, v); this.setFlag(C, newC); this.setZN(v); base += 7; break; } // ROR abs,X

      // --- Unofficial RMW + ALU combos ---
      // SLO: (ASL mem) then ORA A
      case 0x03: { const { addr } = this.adrINDX(); let v = this.read(addr!); v = this.aslByte(v); this.write(addr!, v); s.a = (s.a | v) & 0xff; this.setZN(s.a); base += 8; break; }
      case 0x07: { const { addr } = this.adrZP();    let v = this.read(addr!); v = this.aslByte(v); this.write(addr!, v); s.a = (s.a | v) & 0xff; this.setZN(s.a); base += 5; break; }
      case 0x0F: { const { addr } = this.adrABS();   let v = this.read(addr!); v = this.aslByte(v); this.write(addr!, v); s.a = (s.a | v) & 0xff; this.setZN(s.a); base += 6; break; }
      case 0x13: { const { addr } = this.adrINDY(); let v = this.read(addr!); v = this.aslByte(v); this.write(addr!, v); s.a = (s.a | v) & 0xff; this.setZN(s.a); base += 8; break; }
      case 0x17: { const { addr } = this.adrZPX();   let v = this.read(addr!); v = this.aslByte(v); this.write(addr!, v); s.a = (s.a | v) & 0xff; this.setZN(s.a); base += 6; break; }
      case 0x1B: { const { addr } = this.adrABSY();  let v = this.read(addr!); v = this.aslByte(v); this.write(addr!, v); s.a = (s.a | v) & 0xff; this.setZN(s.a); base += 7; break; }
      case 0x1F: { const { addr } = this.adrABSX();  let v = this.read(addr!); v = this.aslByte(v); this.write(addr!, v); s.a = (s.a | v) & 0xff; this.setZN(s.a); base += 7; break; }
      // RLA: (ROL mem) then AND A
      case 0x23: { const { addr } = this.adrINDX(); let v = this.read(addr!); v = this.rolByte(v); this.write(addr!, v); s.a = (s.a & v) & 0xff; this.setZN(s.a); base += 8; break; }
      case 0x27: { const { addr } = this.adrZP();    let v = this.read(addr!); v = this.rolByte(v); this.write(addr!, v); s.a = (s.a & v) & 0xff; this.setZN(s.a); base += 5; break; }
      case 0x2F: { const { addr } = this.adrABS();   let v = this.read(addr!); v = this.rolByte(v); this.write(addr!, v); s.a = (s.a & v) & 0xff; this.setZN(s.a); base += 6; break; }
      case 0x33: { const { addr } = this.adrINDY(); let v = this.read(addr!); v = this.rolByte(v); this.write(addr!, v); s.a = (s.a & v) & 0xff; this.setZN(s.a); base += 8; break; }
      case 0x37: { const { addr } = this.adrZPX();   let v = this.read(addr!); v = this.rolByte(v); this.write(addr!, v); s.a = (s.a & v) & 0xff; this.setZN(s.a); base += 6; break; }
      case 0x3B: { const { addr } = this.adrABSY();  let v = this.read(addr!); v = this.rolByte(v); this.write(addr!, v); s.a = (s.a & v) & 0xff; this.setZN(s.a); base += 7; break; }
      case 0x3F: { const { addr } = this.adrABSX();  let v = this.read(addr!); v = this.rolByte(v); this.write(addr!, v); s.a = (s.a & v) & 0xff; this.setZN(s.a); base += 7; break; }
      // SRE: (LSR mem) then EOR A
      case 0x43: { const { addr } = this.adrINDX(); let v = this.read(addr!); v = this.lsrByte(v); this.write(addr!, v); s.a = (s.a ^ v) & 0xff; this.setZN(s.a); base += 8; break; }
      case 0x47: { const { addr } = this.adrZP();    let v = this.read(addr!); v = this.lsrByte(v); this.write(addr!, v); s.a = (s.a ^ v) & 0xff; this.setZN(s.a); base += 5; break; }
      case 0x4F: { const { addr } = this.adrABS();   let v = this.read(addr!); v = this.lsrByte(v); this.write(addr!, v); s.a = (s.a ^ v) & 0xff; this.setZN(s.a); base += 6; break; }
      case 0x53: { const { addr } = this.adrINDY(); let v = this.read(addr!); v = this.lsrByte(v); this.write(addr!, v); s.a = (s.a ^ v) & 0xff; this.setZN(s.a); base += 8; break; }
      case 0x57: { const { addr } = this.adrZPX();   let v = this.read(addr!); v = this.lsrByte(v); this.write(addr!, v); s.a = (s.a ^ v) & 0xff; this.setZN(s.a); base += 6; break; }
      case 0x5B: { const { addr } = this.adrABSY();  let v = this.read(addr!); v = this.lsrByte(v); this.write(addr!, v); s.a = (s.a ^ v) & 0xff; this.setZN(s.a); base += 7; break; }
      case 0x5F: { const { addr } = this.adrABSX();  let v = this.read(addr!); v = this.lsrByte(v); this.write(addr!, v); s.a = (s.a ^ v) & 0xff; this.setZN(s.a); base += 7; break; }
      // RRA: (ROR mem) then ADC
      case 0x63: { const { addr } = this.adrINDX(); let v = this.read(addr!); v = this.rorByte(v); this.write(addr!, v); this.adc(v); base += 8; break; }
      case 0x67: { const { addr } = this.adrZP();    let v = this.read(addr!); v = this.rorByte(v); this.write(addr!, v); this.adc(v); base += 5; break; }
      case 0x6F: { const { addr } = this.adrABS();   let v = this.read(addr!); v = this.rorByte(v); this.write(addr!, v); this.adc(v); base += 6; break; }
      case 0x73: { const { addr } = this.adrINDY(); let v = this.read(addr!); v = this.rorByte(v); this.write(addr!, v); this.adc(v); base += 8; break; }
      case 0x77: { const { addr } = this.adrZPX();   let v = this.read(addr!); v = this.rorByte(v); this.write(addr!, v); this.adc(v); base += 6; break; }
      case 0x7B: { const { addr } = this.adrABSY();  let v = this.read(addr!); v = this.rorByte(v); this.write(addr!, v); this.adc(v); base += 7; break; }
      case 0x7F: { const { addr } = this.adrABSX();  let v = this.read(addr!); v = this.rorByte(v); this.write(addr!, v); this.adc(v); base += 7; break; }
      // DCP: (DEC mem) then CMP
      case 0xC3: { const { addr } = this.adrINDX(); let v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.cmp(s.a, v); base += 8; break; }
      case 0xC7: { const { addr } = this.adrZP();    let v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.cmp(s.a, v); base += 5; break; }
      case 0xCF: { const { addr } = this.adrABS();   let v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.cmp(s.a, v); base += 6; break; }
      case 0xD3: { const { addr } = this.adrINDY(); let v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.cmp(s.a, v); base += 8; break; }
      case 0xD7: { const { addr } = this.adrZPX();   let v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.cmp(s.a, v); base += 6; break; }
      case 0xDB: { const { addr } = this.adrABSY();  let v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.cmp(s.a, v); base += 7; break; }
      case 0xDF: { const { addr } = this.adrABSX();  let v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.cmp(s.a, v); base += 7; break; }
      // ISB/ISC: (INC mem) then SBC
      case 0xE3: { const { addr } = this.adrINDX(); let v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.sbc(v); base += 8; break; }
      case 0xE7: { const { addr } = this.adrZP();    let v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.sbc(v); base += 5; break; }
      case 0xEF: { const { addr } = this.adrABS();   let v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.sbc(v); base += 6; break; }
      case 0xF3: { const { addr } = this.adrINDY(); let v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.sbc(v); base += 8; break; }
      case 0xF7: { const { addr } = this.adrZPX();   let v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.sbc(v); base += 6; break; }
      case 0xFB: { const { addr } = this.adrABSY();  let v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.sbc(v); base += 7; break; }
      case 0xFF: { const { addr } = this.adrABSX();  let v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.sbc(v); base += 7; break; }
      // BIT
      case 0x24: { const { addr } = this.adrZP(); const v = this.read(addr!); this.setFlag(Z, (s.a & v) === 0); this.setFlag(V, (v & 0x40) !== 0); this.setFlag(N, (v & 0x80) !== 0); base += 3; break; }
      case 0x2C: { const { addr } = this.adrABS(); const v = this.read(addr!); this.setFlag(Z, (s.a & v) === 0); this.setFlag(V, (v & 0x40) !== 0); this.setFlag(N, (v & 0x80) !== 0); base += 4; break; }
      // DOP/NOP #imm (0x89): fetch and ignore immediate; flags unchanged
      case 0x89: { this.fetch8(); base += 2; break; }
      // CMP/CPX/CPY
      case 0xC9: { const { value } = this.adrIMM(); this.cmp(s.a, value!); base += 2; break; }
      case 0xC5: { const { addr } = this.adrZP(); this.cmp(s.a, this.read(addr!)); base += 3; break; }
      case 0xD5: { const { addr } = this.adrZPX(); this.cmp(s.a, this.read(addr!)); base += 4; break; }
      case 0xCD: { const { addr } = this.adrABS(); this.cmp(s.a, this.read(addr!)); base += 4; break; }
      case 0xDD: { const { addr, crossed } = this.adrABSX(); this.cmp(s.a, this.read(addr!)); base += 4 + (crossed ? 1 : 0); break; }
      case 0xD9: { const { addr, crossed } = this.adrABSY(); this.cmp(s.a, this.read(addr!)); base += 4 + (crossed ? 1 : 0); break; }
      case 0xC1: { const { addr } = this.adrINDX(); this.cmp(s.a, this.read(addr!)); base += 6; break; }
      case 0xD1: { const { addr, crossed } = this.adrINDY(); this.cmp(s.a, this.read(addr!)); base += 5 + (crossed ? 1 : 0); break; }
      case 0xE0: { const { value } = this.adrIMM(); this.cmp(s.x, value!); base += 2; break; } // CPX
      case 0xE4: { const { addr } = this.adrZP(); this.cmp(s.x, this.read(addr!)); base += 3; break; }
      case 0xEC: { const { addr } = this.adrABS(); this.cmp(s.x, this.read(addr!)); base += 4; break; }
      case 0xC0: { const { value } = this.adrIMM(); this.cmp(s.y, value!); base += 2; break; } // CPY
      case 0xC4: { const { addr } = this.adrZP(); this.cmp(s.y, this.read(addr!)); base += 3; break; }
      case 0xCC: { const { addr } = this.adrABS(); this.cmp(s.y, this.read(addr!)); base += 4; break; }
      // Flag ops
      case 0x18: this.setFlag(C, false); base += 2; break; // CLC
      case 0x38: this.setFlag(C, true); base += 2; break; // SEC
      case 0x58: { 
        try { const env = (typeof process !== 'undefined' ? (process as any).env : undefined); if (env && env.TRACE_IRQ_VECTOR === '1') { /* eslint-disable no-console */ console.log(`[cpu] CLI executed pc=$${pcBefore.toString(16).padStart(4,'0')} cycles=${s.cycles} p=$${s.p.toString(16).padStart(2,'0')}`); /* eslint-enable no-console */ } } catch {} 
        const wasSet = this.getFlag(I);
        this.setFlag(I, false); 
        // If I was set and is now clear, and IRQ line is active, delay the IRQ by one instruction
        if (wasSet && this.irqLine) {
          this.irqInhibitNext = true;
          this.delayedIrqPending = true;
        }
        base += 2; 
        break; 
      } // CLI
      case 0x78: { 
        try { const env = (typeof process !== 'undefined' ? (process as any).env : undefined); if (env && env.TRACE_IRQ_VECTOR === '1') { /* eslint-disable no-console */ console.log(`[cpu] SEI executed pc=$${pcBefore.toString(16).padStart(4,'0')} cycles=${s.cycles} p=$${s.p.toString(16).padStart(2,'0')}`); /* eslint-enable no-console */ } } catch {} 
        this.setFlag(I, true); 
        // SEI doesn't cause delay - it sets the flag immediately
        base += 2; 
        break; 
      } // SEI
      case 0xB8: this.setFlag(V, false); base += 2; break; // CLV
      case 0xD8: this.setFlag(D, false); base += 2; break; // CLD
      case 0xF8: this.setFlag(D, true); base += 2; break; // SED
      // Branches
      case 0x90: { // BCC
        const off = (this.fetch8() << 24) >> 24; let cy = 2; if (!this.getFlag(C)) { const old = s.pc; s.pc = (s.pc + off) & 0xffff; cy++; if ((old & 0xff00) !== (s.pc & 0xff00)) cy++; } base += cy; break;
      }
      case 0xB0: { // BCS
        const off = (this.fetch8() << 24) >> 24; let cy = 2; if (this.getFlag(C)) { const old = s.pc; s.pc = (s.pc + off) & 0xffff; cy++; if ((old & 0xff00) !== (s.pc & 0xff00)) cy++; } base += cy; break;
      }
      case 0xF0: { // BEQ
        const off = (this.fetch8() << 24) >> 24; let cy = 2; if (this.getFlag(Z)) { const old = s.pc; s.pc = (s.pc + off) & 0xffff; cy++; if ((old & 0xff00) !== (s.pc & 0xff00)) cy++; } base += cy; break;
      }
      case 0xD0: { // BNE
        const off = (this.fetch8() << 24) >> 24; let cy = 2; if (!this.getFlag(Z)) { const old = s.pc; s.pc = (s.pc + off) & 0xffff; cy++; if ((old & 0xff00) !== (s.pc & 0xff00)) cy++; } base += cy; break;
      }
      case 0x10: { // BPL
        const off = (this.fetch8() << 24) >> 24; let cy = 2; if (!this.getFlag(N)) { const old = s.pc; s.pc = (s.pc + off) & 0xffff; cy++; if ((old & 0xff00) !== (s.pc & 0xff00)) cy++; } base += cy; break;
      }
      case 0x30: { // BMI
        const off = (this.fetch8() << 24) >> 24; let cy = 2; if (this.getFlag(N)) { const old = s.pc; s.pc = (s.pc + off) & 0xffff; cy++; if ((old & 0xff00) !== (s.pc & 0xff00)) cy++; } base += cy; break;
      }
      case 0x50: { // BVC
        const off = (this.fetch8() << 24) >> 24; let cy = 2; if (!this.getFlag(V)) { const old = s.pc; s.pc = (s.pc + off) & 0xffff; cy++; if ((old & 0xff00) !== (s.pc & 0xff00)) cy++; } base += cy; break;
      }
      case 0x70: { // BVS
        const off = (this.fetch8() << 24) >> 24; let cy = 2; if (this.getFlag(V)) { const old = s.pc; s.pc = (s.pc + off) & 0xffff; cy++; if ((old & 0xff00) !== (s.pc & 0xff00)) cy++; } base += cy; break;
      }
      // Jumps/subroutines
      case 0x4C: { const { addr } = this.adrABS(); s.pc = addr!; base += 3; break; } // JMP abs
      case 0x6C: { const { addr } = this.adrIND(); s.pc = addr!; base += 5; break; } // JMP ind
      case 0x20: { // JSR abs
        const addr = this.fetch16();
        const ret = (s.pc - 1) & 0xffff;
        const spBefore = s.s & 0xFF;
        this.push16(ret);
        try {
          const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
          if (env && env.TRACE_JSR === '1') {
            const spAfter = this.state.s & 0xFF;
            const hiAddr = (0x0100 + ((spAfter + 1) & 0xFF)) & 0xFFFF; // where high byte was stored
            const loAddr = (0x0100 + ((spAfter + 2) & 0xFF)) & 0xFFFF; // where low byte was stored
            // eslint-disable-next-line no-console
            console.log(`[cpu] JSR $${addr.toString(16).padStart(4,'0')} push=$${ret.toString(16).padStart(4,'0')} to [$${loAddr.toString(16).padStart(4,'0')},$${hiAddr.toString(16).padStart(4,'0')}] sp ${spBefore.toString(16).padStart(2,'0')}->${spAfter.toString(16).padStart(2,'0')}`);
          }
        } catch {}
        s.pc = addr;
        base += 6;
        break;
      } // JSR
      case 0x60: { // RTS
        const ret = this.pop16();
        try {
          const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
          if (env && env.TRACE_RTS === '1') {
            // Infer the two stack addresses just consumed: S increased by 2 during pop16()
            const sp = this.state.s & 0xFF;
            const loAddr = (0x0100 + ((sp - 1) & 0xFF)) & 0xFFFF;
            const hiAddr = (0x0100 + (sp & 0xFF)) & 0xFFFF;
            // eslint-disable-next-line no-console
            console.log(`[cpu] RTS pop=$${ret.toString(16).padStart(4,'0')} from [$${loAddr.toString(16).padStart(4,'0')},$${hiAddr.toString(16).padStart(4,'0')}] -> sp=$${sp.toString(16).padStart(2,'0')}`);
          }
        } catch {}
        const addr = (ret + 1) & 0xffff; s.pc = addr; base += 6; break; } // RTS
      // BRK/RTI (basic)
      case 0x00: { // BRK
        // BRK fetch advanced PC by 1. Push PC + brkPushDelta (pc+2 for conformance by default; pc+1 in simplified mode), then P|B|U, then vector.
        const ret = (s.pc + this.brkPushDelta) & 0xFFFF;
        this.push16(ret);
        this.push8((s.p | B | U) & 0xff);
        this.setFlag(I, true);
        const vec = this.read16(0xfffe);
        s.pc = vec;
        base += 7;
        break;
      }
      case 0x40: { // RTI
        s.p = (this.pop8() & ~B) | U;
        s.pc = this.pop16();
        // RTI just restores state - it doesn't cause IRQ delays
        // If RTI sets I flag, cancel any pending delayed IRQ from previous CLI
        if ((s.p & I) !== 0) {
          this.delayedIrqPending = false;
        }
        base += 6;
        break;
      }
      // Unofficial NOPs commonly used by test ROMs (treat as NOP with proper read timing)
      case 0x1A: case 0x3A: case 0x5A: case 0x7A: case 0xDA: case 0xFA: // 1-byte NOP
        base += 2; break;
      // Unstable: XAA (#imm) approximated as A = X & imm
      case 0x8B: { const { value } = this.adrIMM(); s.a = s.x & value!; this.setZN(s.a); base += 2; break; }
      // Unofficial: AXS/SBX (#imm) = X = (A & X) - imm; C set as (A&X)>=imm
      case 0xCB: { const { value } = this.adrIMM(); const t = (s.a & s.x) & 0xff; const imm = value!; const res = (t - imm) & 0xff; this.setFlag(C, t >= imm); s.x = res; this.setZN(s.x); base += 2; break; }
      case 0x80: case 0x82: case 0xC2: case 0xE2: { this.fetch8(); base += 2; break; } // NOP #imm (2-byte variants)
      case 0x04: case 0x44: case 0x64: { this.adrZP(); base += 3; break; } // NOP zp
      case 0x14: case 0x34: case 0x54: case 0x74: case 0xD4: case 0xF4: { this.adrZPX(); base += 4; break; } // NOP zp,X
      case 0x0C: { this.adrABS(); base += 4; break; } // NOP abs
      case 0x1C: case 0x3C: case 0x5C: case 0x7C: case 0xDC: case 0xFC: { const { crossed } = this.adrABSX(); base += 4 + (crossed ? 1 : 0); break; } // NOP abs,X
      
      // KIL/JAM opcodes (unofficial): configurable behavior
      case 0x02: case 0x12: case 0x22: case 0x32: case 0x42: case 0x52: case 0x62: case 0x72: case 0x92: case 0xB2: case 0xD2: case 0xF2:
        if (this.illegalMode === 'strict') { this.jammed = true; return; } else { base += 2; break; }

      default: {
        const s0 = this.state;
        // record trace ring before throwing
        this.tracePC[this.traceIdx & 63] = pcBefore;
        this.traceIdx++;
        const opPc = (s0.pc - 1) & 0xffff;
        const dump = (start: number, len: number) => {
          const bytes: string[] = [];
          for (let i = 0; i < len; i++) {
            const b = this.read((start + i) & 0xffff);
            bytes.push(b.toString(16).padStart(2, '0'));
          }
          return bytes.join(' ');
        };
        const before = (opPc - 8) & 0xffff;
        const around = dump(before, 17);
        const regs = `A=${s0.a.toString(16).padStart(2,'0')} X=${s0.x.toString(16).padStart(2,'0')} Y=${s0.y.toString(16).padStart(2,'0')} S=${s0.s.toString(16).padStart(2,'0')} P=${s0.p.toString(16).padStart(2,'0')} CYC=${s0.cycles}`;
        // build recent PC trace
        const pcs: string[] = [];
        const count = Math.min(16, this.traceIdx);
        for (let i = count - 1; i >= 0; i--) {
          const idx = (this.traceIdx - 1 - i) & 63;
          pcs.push(`$${this.tracePC[idx].toString(16).padStart(4,'0')}`);
        }
        // dump a portion of stack page around S
        const sBase = 0x0100;
        const sStart = (sBase + ((s0.s + 1) & 0xff)) & 0xffff; // next pull location
        const sDump = dump(sBase, 32);
        const msg = `Opcode not implemented: $${opcode.toString(16)} at $${opPc.toString(16).padStart(4,'0')}\nRegs: ${regs}\nMem[$${((opPc-8)&0xffff).toString(16).padStart(4,'0')}..]: ${around}\nTracePC: ${pcs.join(' ')}\nStack[S=${s0.s.toString(16)} next=$${sStart.toString(16)}]: ${sDump}`;
        throw new Error(msg);
      }
    }
    if (this.extraTraceHook) { try { this.extraTraceHook({ pc: pcBefore, opcode, ea: this.lastEA, crossed: this.lastCrossed }); } catch {} }
    // Optional: log effective address for this instruction within the trace window
    try {
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      const win = env?.TRACE_PC_WINDOW as string | undefined;
      if (win && this.lastEA !== null) {
        const m = /^(\d+)-(\d+)$/.exec(win);
        if (m) {
          const a = parseInt(m[1], 10) | 0;
          const b = parseInt(m[2], 10) | 0;
          const cyc = this.state.cycles | 0;
          const inWin = (cyc >= a && cyc <= b);
          if (inWin) {
            // eslint-disable-next-line no-console
            console.log(`[traceea] pc=$${pcBefore.toString(16).padStart(4,'0')} ea=$${(this.lastEA & 0xFFFF).toString(16).padStart(4,'0')} crossed=${this.lastCrossed ? 1 : 0} cyc=${cyc}`);
          }
        }
      }
    } catch {}
    // publish bus access count for this step
    this.lastBusAccessCount = this.busAccessCountCurr;
    // Tick remaining internal cycles inline so PPU/APU stay interleaved correctly
    const internal = base - this.busAccessCountCurr;
    if (internal > 0) this.incCycle(internal);

    // Optional: if TRACE_STACK_TOP_MATCH is set, log when the next RTS/RTI return address equals the target
    if (this.traceStackTopMatch !== null) {
      try {
        const sTop = (this.state.s + 1) & 0xFF;
        const lo = this.bus.read(0x0100 + sTop) & 0xFF;
        const hi = this.bus.read(0x0100 + ((sTop + 1) & 0xFF)) & 0xFF;
        const val = (hi << 8) | lo;
        if (val === this.traceStackTopMatch) {
          // eslint-disable-next-line no-console
          console.log(`[stacktop] match=$${val.toString(16).padStart(4,'0')} at PC=$${this.state.pc.toString(16).padStart(4,'0')} SP=$${this.state.s.toString(16).padStart(2,'0')}`);
        }
      } catch {}
    }

    // Optional SP trace (post)
    if (this.spTraceEnabled) {
      const pcAfter = this.state.pc & 0xFFFF;
      const pcv = pcBefore & 0xFFFF;
      if ((pcv >= this.spTraceStart && pcv <= this.spTraceEnd) || (pcAfter >= this.spTraceStart && pcAfter <= this.spTraceEnd)) {
        const cycDelta = (this.state.cycles | 0) - cycBeforeInstr;
        try { /* eslint-disable no-console */ console.log(`[sp] post PC=$${pcAfter.toString(16).padStart(4,'0')} SP=$${this.state.s.toString(16).padStart(2,'0')} P=$${this.state.p.toString(16).padStart(2,'0')} dCYC=${cycDelta}`); /* eslint-enable no-console */ } catch {}
      }
    }
  }
}
