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
  private irqPending = false;
  private jammed = false; // set when encountering JAM/KIL in strict mode
  private illegalMode: 'lenient' | 'strict' = 'lenient';
  // simple trace ring for debugging
  private tracePC: number[] = new Array(64).fill(0);
  private traceIdx = 0;
  // optional external per-instruction trace hook
  private traceHook: ((pc: number, opcode: number) => void) | null = null;
  constructor(private bus: CPUBus) {
    this.state = { a: 0, x: 0, y: 0, s: 0xfd, pc: 0, p: 0x24, cycles: 0 };
  }

  // Enable/disable a per-instruction trace callback (for harness debugging)
  setTraceHook(fn: ((pc: number, opcode: number) => void) | null) { this.traceHook = fn; }

  reset(vector: Word) {
    this.state = { a: 0, x: 0, y: 0, s: 0xfd, pc: vector & 0xffff, p: 0x24, cycles: 0 };
    this.nmiPending = false; this.irqPending = false; this.jammed = false;
  }

  // Configure behavior for unofficial KIL/JAM opcodes
  setIllegalMode(mode: 'lenient' | 'strict') { this.illegalMode = mode; }

  requestNMI() { this.nmiPending = true; }
  requestIRQ() { this.irqPending = true; }
  addCycles(n: number) { this.state.cycles += n; }

  // Memory helpers
  private read(addr: Word): Byte { return this.bus.read(addr & 0xffff) & 0xff; }
  private write(addr: Word, v: Byte): void { this.bus.write(addr & 0xffff, v & 0xff); }
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
    this.push16(pc);
    this.push8((this.state.p & ~(B)) | U);
    this.setFlag(I, true);
    this.state.pc = vector & 0xffff;
    this.state.cycles += 7;
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
    this.state.p = (this.state.p & ~mask) | (val ? mask : 0);
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
  private adrZP() { return { addr: this.fetch8(), crossed: false }; }
  private adrZPX() { return { addr: (this.fetch8() + this.state.x) & 0xff, crossed: false }; }
  private adrZPY() { return { addr: (this.fetch8() + this.state.y) & 0xff, crossed: false }; }
  private adrABS() { return { addr: this.fetch16(), crossed: false }; }
  private adrABSX() {
    const base = this.fetch16();
    const addr = (base + this.state.x) & 0xffff;
    return { addr, crossed: (base & 0xff00) !== (addr & 0xff00) };
  }
  private adrABSY() {
    const base = this.fetch16();
    const addr = (base + this.state.y) & 0xffff;
    return { addr, crossed: (base & 0xff00) !== (addr & 0xff00) };
  }
  private adrIND() {
    // 6502 JMP indirect bug emulation
    const ptr = this.fetch16();
    const lo = this.read(ptr);
    const hiAddr = (ptr & 0xff00) | ((ptr + 1) & 0x00ff);
    const hi = this.read(hiAddr);
    return { addr: lo | (hi << 8), crossed: false };
  }
  private adrINDX() {
    const zp = (this.fetch8() + this.state.x) & 0xff;
    const lo = this.read(zp);
    const hi = this.read((zp + 1) & 0xff);
    return { addr: lo | (hi << 8), crossed: false };
  }
  private adrINDY() {
    const zp = this.fetch8();
    const lo = this.read(zp);
    const hi = this.read((zp + 1) & 0xff);
    const base = lo | (hi << 8);
    const addr = (base + this.state.y) & 0xffff;
    return { addr, crossed: (base & 0xff00) !== (addr & 0xff00) };
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
      this.interrupt(vec);
      return true;
    }
    if (this.irqPending && !this.getFlag(I)) {
      this.irqPending = false;
      const vec = this.read16(0xfffe);
      this.interrupt(vec);
      return true;
    }
    return false;
  }

  step(): void {
    // If jammed (strict KIL), halt execution (no further cycles progress)
    if (this.jammed) return;
    // Service interrupts between instructions
    if (this.serviceInterrupts()) return;

    const pcBefore = this.state.pc;
    // record every step
    this.tracePC[this.traceIdx & 63] = pcBefore;
    this.traceIdx++;
    const opcode = this.fetch8();
    // optional external tracing
    if (this.traceHook) { try { this.traceHook(pcBefore, opcode); } catch {} }
    // Base cycles table for implemented opcodes
    const s = this.state;
    switch (opcode) {
      // NOP
      case 0xEA: s.cycles += 2; break;
      // LDA
      case 0xA9: { const { value } = this.adrIMM(); s.a = value!; this.setZN(s.a); s.cycles += 2; break; }
      case 0xA5: { const { addr } = this.adrZP(); s.a = this.read(addr!); this.setZN(s.a); s.cycles += 3; break; }
      case 0xB5: { const { addr } = this.adrZPX(); s.a = this.read(addr!); this.setZN(s.a); s.cycles += 4; break; }
      case 0xAD: { const { addr } = this.adrABS(); s.a = this.read(addr!); this.setZN(s.a); s.cycles += 4; break; }
      case 0xBD: { const { addr, crossed } = this.adrABSX(); s.a = this.read(addr!); this.setZN(s.a); s.cycles += 4 + (crossed ? 1 : 0); break; }
      case 0xB9: { const { addr, crossed } = this.adrABSY(); s.a = this.read(addr!); this.setZN(s.a); s.cycles += 4 + (crossed ? 1 : 0); break; }
      case 0xA1: { const { addr } = this.adrINDX(); s.a = this.read(addr!); this.setZN(s.a); s.cycles += 6; break; }
      case 0xB1: { const { addr, crossed } = this.adrINDY(); s.a = this.read(addr!); this.setZN(s.a); s.cycles += 5 + (crossed ? 1 : 0); break; }
      // LDX
      case 0xA2: { const { value } = this.adrIMM(); s.x = value!; this.setZN(s.x); s.cycles += 2; break; }
      case 0xA6: { const { addr } = this.adrZP(); s.x = this.read(addr!); this.setZN(s.x); s.cycles += 3; break; }
      case 0xB6: { const { addr } = this.adrZPY(); s.x = this.read(addr!); this.setZN(s.x); s.cycles += 4; break; }
      case 0xAE: { const { addr } = this.adrABS(); s.x = this.read(addr!); this.setZN(s.x); s.cycles += 4; break; }
      case 0xBE: { const { addr, crossed } = this.adrABSY(); s.x = this.read(addr!); this.setZN(s.x); s.cycles += 4 + (crossed ? 1 : 0); break; }
      // LDY
      case 0xA0: { const { value } = this.adrIMM(); s.y = value!; this.setZN(s.y); s.cycles += 2; break; }
      case 0xA4: { const { addr } = this.adrZP(); s.y = this.read(addr!); this.setZN(s.y); s.cycles += 3; break; }
      case 0xB4: { const { addr } = this.adrZPX(); s.y = this.read(addr!); this.setZN(s.y); s.cycles += 4; break; }
      case 0xAC: { const { addr } = this.adrABS(); s.y = this.read(addr!); this.setZN(s.y); s.cycles += 4; break; }
      case 0xBC: { const { addr, crossed } = this.adrABSX(); s.y = this.read(addr!); this.setZN(s.y); s.cycles += 4 + (crossed ? 1 : 0); break; }
      // STA
      case 0x85: { const { addr } = this.adrZP(); this.write(addr!, s.a); s.cycles += 3; break; }
      case 0x95: { const { addr } = this.adrZPX(); this.write(addr!, s.a); s.cycles += 4; break; }
      case 0x8D: { const { addr } = this.adrABS(); this.write(addr!, s.a); s.cycles += 4; break; }
      case 0x9D: { const { addr } = this.adrABSX(); this.write(addr!, s.a); s.cycles += 5; break; }
      case 0x99: { const { addr } = this.adrABSY(); this.write(addr!, s.a); s.cycles += 5; break; }
      case 0x81: { const { addr } = this.adrINDX(); this.write(addr!, s.a); s.cycles += 6; break; }
      case 0x91: { const { addr } = this.adrINDY(); this.write(addr!, s.a); s.cycles += 6; break; }
      // Unofficial: SAX (store A & X)
      case 0x87: { const { addr } = this.adrZP(); this.write(addr!, s.a & s.x); s.cycles += 3; break; }      // SAX zp
      case 0x97: { const { addr } = this.adrZPY(); this.write(addr!, s.a & s.x); s.cycles += 4; break; }     // SAX zp,Y
      case 0x8F: { const { addr } = this.adrABS(); this.write(addr!, s.a & s.x); s.cycles += 4; break; }      // SAX abs
      case 0x83: { const { addr } = this.adrINDX(); this.write(addr!, s.a & s.x); s.cycles += 6; break; }     // SAX (zp,X)
      // STX
      case 0x86: { const { addr } = this.adrZP(); this.write(addr!, s.x); s.cycles += 3; break; }
      case 0x96: { const { addr } = this.adrZPY(); this.write(addr!, s.x); s.cycles += 4; break; }
      case 0x8E: { const { addr } = this.adrABS(); this.write(addr!, s.x); s.cycles += 4; break; }
      // STY
      case 0x84: { const { addr } = this.adrZP(); this.write(addr!, s.y); s.cycles += 3; break; }
      case 0x94: { const { addr } = this.adrZPX(); this.write(addr!, s.y); s.cycles += 4; break; }
      case 0x8C: { const { addr } = this.adrABS(); this.write(addr!, s.y); s.cycles += 4; break; }
      // Transfers
      case 0xAA: s.x = s.a; this.setZN(s.x); s.cycles += 2; break; // TAX
      case 0xA8: s.y = s.a; this.setZN(s.y); s.cycles += 2; break; // TAY
      case 0x8A: s.a = s.x; this.setZN(s.a); s.cycles += 2; break; // TXA
      case 0x98: s.a = s.y; this.setZN(s.a); s.cycles += 2; break; // TYA
      case 0xBA: s.x = s.s; this.setZN(s.x); s.cycles += 2; break; // TSX
      case 0x9A: s.s = s.x; /* no flags */ s.cycles += 2; break; // TXS
      // Stack
      case 0x48: this.push8(s.a); s.cycles += 3; break; // PHA
      case 0x68: s.a = this.pop8(); this.setZN(s.a); s.cycles += 4; break; // PLA
      case 0x08: this.push8((s.p | U | B) & 0xff); s.cycles += 3; break; // PHP
      case 0x28: s.p = (this.pop8() & ~B) | U; s.cycles += 4; break; // PLP
      // AND/ORA/EOR
      // AND
      case 0x29: { const { value } = this.adrIMM(); s.a = s.a & value!; this.setZN(s.a); s.cycles += 2; break; }
      case 0x25: { const { addr } = this.adrZP(); s.a = s.a & this.read(addr!); this.setZN(s.a); s.cycles += 3; break; }
      case 0x35: { const { addr } = this.adrZPX(); s.a = s.a & this.read(addr!); this.setZN(s.a); s.cycles += 4; break; }
      case 0x2D: { const { addr } = this.adrABS(); s.a = s.a & this.read(addr!); this.setZN(s.a); s.cycles += 4; break; }
      case 0x3D: { const { addr, crossed } = this.adrABSX(); s.a = s.a & this.read(addr!); this.setZN(s.a); s.cycles += 4 + (crossed ? 1 : 0); break; }
      case 0x39: { const { addr, crossed } = this.adrABSY(); s.a = s.a & this.read(addr!); this.setZN(s.a); s.cycles += 4 + (crossed ? 1 : 0); break; }
      case 0x21: { const { addr } = this.adrINDX(); s.a = s.a & this.read(addr!); this.setZN(s.a); s.cycles += 6; break; }
      case 0x31: { const { addr, crossed } = this.adrINDY(); s.a = s.a & this.read(addr!); this.setZN(s.a); s.cycles += 5 + (crossed ? 1 : 0); break; }
      // ORA
      case 0x09: { const { value } = this.adrIMM(); s.a = s.a | value!; this.setZN(s.a); s.cycles += 2; break; }
      case 0x05: { const { addr } = this.adrZP(); s.a = s.a | this.read(addr!); this.setZN(s.a); s.cycles += 3; break; }
      case 0x15: { const { addr } = this.adrZPX(); s.a = s.a | this.read(addr!); this.setZN(s.a); s.cycles += 4; break; }
      case 0x0D: { const { addr } = this.adrABS(); s.a = s.a | this.read(addr!); this.setZN(s.a); s.cycles += 4; break; }
      case 0x1D: { const { addr, crossed } = this.adrABSX(); s.a = s.a | this.read(addr!); this.setZN(s.a); s.cycles += 4 + (crossed ? 1 : 0); break; }
      case 0x19: { const { addr, crossed } = this.adrABSY(); s.a = s.a | this.read(addr!); this.setZN(s.a); s.cycles += 4 + (crossed ? 1 : 0); break; }
      case 0x01: { const { addr } = this.adrINDX(); s.a = s.a | this.read(addr!); this.setZN(s.a); s.cycles += 6; break; }
      case 0x11: { const { addr, crossed } = this.adrINDY(); s.a = s.a | this.read(addr!); this.setZN(s.a); s.cycles += 5 + (crossed ? 1 : 0); break; }
      
      // Unofficial: LAX (load A and X) - behaves like LDA then TAX
      case 0xA7: { const { addr } = this.adrZP(); const v = this.read(addr!); s.a = v; s.x = v; this.setZN(v); s.cycles += 3; break; }      // LAX zp
      // Unofficial: LAS abs,Y (0xBB): A,X,S = (mem & S); flags from A; cycles like LDA abs,Y
      case 0xBB: { const { addr, crossed } = this.adrABSY(); const m = this.read(addr!); const val = m & s.s; s.a = val; s.x = val; s.s = val; this.setZN(s.a); s.cycles += 4 + (crossed ? 1 : 0); break; }
      case 0xB7: { const { addr } = this.adrZPY(); const v = this.read(addr!); s.a = v; s.x = v; this.setZN(v); s.cycles += 4; break; }     // LAX zp,Y
      case 0xAF: { const { addr } = this.adrABS(); const v = this.read(addr!); s.a = v; s.x = v; this.setZN(v); s.cycles += 4; break; }      // LAX abs
      case 0xBF: { const { addr, crossed } = this.adrABSY(); const v = this.read(addr!); s.a = v; s.x = v; this.setZN(v); s.cycles += 4 + (crossed ? 1 : 0); break; } // LAX abs,Y
      case 0xA3: { const { addr } = this.adrINDX(); const v = this.read(addr!); s.a = v; s.x = v; this.setZN(v); s.cycles += 6; break; }    // LAX (zp,X)
      case 0xB3: { const { addr, crossed } = this.adrINDY(); const v = this.read(addr!); s.a = v; s.x = v; this.setZN(v); s.cycles += 5 + (crossed ? 1 : 0); break; } // LAX (zp),Y
      case 0xAB: { const { value } = this.adrIMM(); const v = value!; s.a = v; s.x = v; this.setZN(v); s.cycles += 2; break; }             // LAX #imm (unstable, but enough for tests)
      // EOR
      case 0x49: { const { value } = this.adrIMM(); s.a = s.a ^ value!; this.setZN(s.a); s.cycles += 2; break; }
      case 0x45: { const { addr } = this.adrZP(); s.a = s.a ^ this.read(addr!); this.setZN(s.a); s.cycles += 3; break; }
      case 0x55: { const { addr } = this.adrZPX(); s.a = s.a ^ this.read(addr!); this.setZN(s.a); s.cycles += 4; break; }
      case 0x4D: { const { addr } = this.adrABS(); s.a = s.a ^ this.read(addr!); this.setZN(s.a); s.cycles += 4; break; }
      case 0x5D: { const { addr, crossed } = this.adrABSX(); s.a = s.a ^ this.read(addr!); this.setZN(s.a); s.cycles += 4 + (crossed ? 1 : 0); break; }
      case 0x59: { const { addr, crossed } = this.adrABSY(); s.a = s.a ^ this.read(addr!); this.setZN(s.a); s.cycles += 4 + (crossed ? 1 : 0); break; }
      case 0x41: { const { addr } = this.adrINDX(); s.a = s.a ^ this.read(addr!); this.setZN(s.a); s.cycles += 6; break; }
      case 0x51: { const { addr, crossed } = this.adrINDY(); s.a = s.a ^ this.read(addr!); this.setZN(s.a); s.cycles += 5 + (crossed ? 1 : 0); break; }
      // ADC/SBC
      // Unofficial: ANC (#imm) = AND then C = bit7(A)
      case 0x0B: case 0x2B: { const { value } = this.adrIMM(); s.a = s.a & value!; this.setZN(s.a); this.setFlag(C, (s.a & 0x80) !== 0); s.cycles += 2; break; }
      case 0x69: { const { value } = this.adrIMM(); this.adc(value!); s.cycles += 2; break; }
      case 0x65: { const { addr } = this.adrZP(); this.adc(this.read(addr!)); s.cycles += 3; break; }
      case 0x75: { const { addr } = this.adrZPX(); this.adc(this.read(addr!)); s.cycles += 4; break; }
      case 0x6D: { const { addr } = this.adrABS(); this.adc(this.read(addr!)); s.cycles += 4; break; }
      case 0x7D: { const { addr, crossed } = this.adrABSX(); this.adc(this.read(addr!)); s.cycles += 4 + (crossed ? 1 : 0); break; }
      case 0x79: { const { addr, crossed } = this.adrABSY(); this.adc(this.read(addr!)); s.cycles += 4 + (crossed ? 1 : 0); break; }
      case 0x61: { const { addr } = this.adrINDX(); this.adc(this.read(addr!)); s.cycles += 6; break; }
      case 0x71: { const { addr, crossed } = this.adrINDY(); this.adc(this.read(addr!)); s.cycles += 5 + (crossed ? 1 : 0); break; }
      case 0xE9: case 0xEB: { const { value } = this.adrIMM(); this.sbc(value!); s.cycles += 2; break; }
      case 0xE5: { const { addr } = this.adrZP(); this.sbc(this.read(addr!)); s.cycles += 3; break; }
      case 0xF5: { const { addr } = this.adrZPX(); this.sbc(this.read(addr!)); s.cycles += 4; break; }
      case 0xED: { const { addr } = this.adrABS(); this.sbc(this.read(addr!)); s.cycles += 4; break; }
      case 0xFD: { const { addr, crossed } = this.adrABSX(); this.sbc(this.read(addr!)); s.cycles += 4 + (crossed ? 1 : 0); break; }
      case 0xF9: { const { addr, crossed } = this.adrABSY(); this.sbc(this.read(addr!)); s.cycles += 4 + (crossed ? 1 : 0); break; }
      case 0xE1: { const { addr } = this.adrINDX(); this.sbc(this.read(addr!)); s.cycles += 6; break; }
      case 0xF1: { const { addr, crossed } = this.adrINDY(); this.sbc(this.read(addr!)); s.cycles += 5 + (crossed ? 1 : 0); break; }
      
      // INC/DEC
      case 0xE6: { const { addr } = this.adrZP(); const v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.setZN(v); s.cycles += 5; break; }
      case 0xF6: { const { addr } = this.adrZPX(); const v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.setZN(v); s.cycles += 6; break; }
      case 0xEE: { const { addr } = this.adrABS(); const v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.setZN(v); s.cycles += 6; break; }
      case 0xFE: { const { addr } = this.adrABSX(); const v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.setZN(v); s.cycles += 7; break; }
      case 0xC6: { const { addr } = this.adrZP(); const v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.setZN(v); s.cycles += 5; break; }
      case 0xD6: { const { addr } = this.adrZPX(); const v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.setZN(v); s.cycles += 6; break; }
      case 0xCE: { const { addr } = this.adrABS(); const v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.setZN(v); s.cycles += 6; break; }
      case 0xDE: { const { addr } = this.adrABSX(); const v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.setZN(v); s.cycles += 7; break; }
      case 0xE8: s.x = (s.x + 1) & 0xff; this.setZN(s.x); s.cycles += 2; break; // INX
      case 0xC8: s.y = (s.y + 1) & 0xff; this.setZN(s.y); s.cycles += 2; break; // INY
      case 0xCA: s.x = (s.x - 1) & 0xff; this.setZN(s.x); s.cycles += 2; break; // DEX
      case 0x88: s.y = (s.y - 1) & 0xff; this.setZN(s.y); s.cycles += 2; break; // DEY
      // Shifts/rotates (accumulator variants)
      // Unofficial: ALR (#imm) = AND then LSR (C from pre-shift bit0)
      case 0x4B: { const { value } = this.adrIMM(); let t = s.a & value!; const c0 = (t & 1) !== 0; t = (t >>> 1) & 0xff; s.a = t; this.setFlag(C, c0); this.setZN(s.a); s.cycles += 2; break; }
      // Unofficial: ARR (#imm) = AND then ROR A (sets V and C specially)
      case 0x6B: { const { value } = this.adrIMM(); const oldC = this.getFlag(C); let t = s.a & value!; let r = ((t >>> 1) | (oldC ? 0x80 : 0)) & 0xff; s.a = r; this.setZN(s.a); this.setFlag(C, (r & 0x40) !== 0); this.setFlag(V, ((r ^ ((r << 1) & 0xff)) & 0x40) !== 0); s.cycles += 2; break; }
      case 0x0A: { const c = (s.a & 0x80) !== 0; s.a = (s.a << 1) & 0xff; this.setFlag(C, c); this.setZN(s.a); s.cycles += 2; break; } // ASL A
      case 0x4A: { const c = (s.a & 0x01) !== 0; s.a = (s.a >>> 1) & 0xff; this.setFlag(C, c); this.setZN(s.a); s.cycles += 2; break; } // LSR A
      case 0x2A: { const c = this.getFlag(C); const newC = (s.a & 0x80) !== 0; s.a = ((s.a << 1) | (c ? 1 : 0)) & 0xff; this.setFlag(C, newC); this.setZN(s.a); s.cycles += 2; break; } // ROL A
      case 0x6A: { const c = this.getFlag(C); const newC = (s.a & 0x01) !== 0; s.a = ((s.a >>> 1) | (c ? 0x80 : 0)) & 0xff; this.setFlag(C, newC); this.setZN(s.a); s.cycles += 2; break; } // ROR A
      // Shifts/rotates (memory variants)
      case 0x06: { const { addr } = this.adrZP(); let v = this.read(addr!); const c = (v & 0x80) !== 0; v = (v << 1) & 0xff; this.write(addr!, v); this.setFlag(C, c); this.setZN(v); s.cycles += 5; break; } // ASL zp
      
      // --- Unofficial stores involving address-high+1 masking (approximations) ---
      // SHY (0x9C) abs,X: store (Y & (high(addr)+1))
      case 0x9C: { const { addr, crossed } = this.adrABSX(); const high = (((addr! >> 8) & 0xFF) + 1) & 0xFF; const val = s.y & high; this.write(addr!, val); s.cycles += 5; break; }
      // SHX (0x9E) abs,Y: store (X & (high(addr)+1))
      case 0x9E: { const { addr, crossed } = this.adrABSY(); const high = (((addr! >> 8) & 0xFF) + 1) & 0xFF; const val = s.x & high; this.write(addr!, val); s.cycles += 5; break; }
      // TAS/SHS (0x9B) abs,Y: S = A & X; store (S & (high(addr)+1))
      case 0x9B: { const { addr, crossed } = this.adrABSY(); s.s = s.a & s.x; const high = (((addr! >> 8) & 0xFF) + 1) & 0xFF; const val = s.s & high; this.write(addr!, val); s.cycles += 5; break; }
      // AHX/SHA (0x9F) abs,Y: store (A & X & (high(addr)+1))
      case 0x9F: { const { addr, crossed } = this.adrABSY(); const high = (((addr! >> 8) & 0xFF) + 1) & 0xFF; const val = s.a & s.x & high; this.write(addr!, val); s.cycles += 5; break; }
      // AHX/SHA (0x93) (zp),Y: store (A & X & (high(addr)+1))
      case 0x93: { const { addr, crossed } = this.adrINDY(); const high = (((addr! >> 8) & 0xFF) + 1) & 0xFF; const val = s.a & s.x & high; this.write(addr!, val); s.cycles += 6; break; }
      case 0x16: { const { addr } = this.adrZPX(); let v = this.read(addr!); const c = (v & 0x80) !== 0; v = (v << 1) & 0xff; this.write(addr!, v); this.setFlag(C, c); this.setZN(v); s.cycles += 6; break; } // ASL zp,X
      case 0x0E: { const { addr } = this.adrABS(); let v = this.read(addr!); const c = (v & 0x80) !== 0; v = (v << 1) & 0xff; this.write(addr!, v); this.setFlag(C, c); this.setZN(v); s.cycles += 6; break; } // ASL abs
      case 0x1E: { const { addr } = this.adrABSX(); let v = this.read(addr!); const c = (v & 0x80) !== 0; v = (v << 1) & 0xff; this.write(addr!, v); this.setFlag(C, c); this.setZN(v); s.cycles += 7; break; } // ASL abs,X
      case 0x46: { const { addr } = this.adrZP(); let v = this.read(addr!); const c = (v & 0x01) !== 0; v = (v >>> 1) & 0xff; this.write(addr!, v); this.setFlag(C, c); this.setZN(v); s.cycles += 5; break; } // LSR zp
      case 0x56: { const { addr } = this.adrZPX(); let v = this.read(addr!); const c = (v & 0x01) !== 0; v = (v >>> 1) & 0xff; this.write(addr!, v); this.setFlag(C, c); this.setZN(v); s.cycles += 6; break; } // LSR zp,X
      case 0x4E: { const { addr } = this.adrABS(); let v = this.read(addr!); const c = (v & 0x01) !== 0; v = (v >>> 1) & 0xff; this.write(addr!, v); this.setFlag(C, c); this.setZN(v); s.cycles += 6; break; } // LSR abs
      case 0x5E: { const { addr } = this.adrABSX(); let v = this.read(addr!); const c = (v & 0x01) !== 0; v = (v >>> 1) & 0xff; this.write(addr!, v); this.setFlag(C, c); this.setZN(v); s.cycles += 7; break; } // LSR abs,X
      case 0x26: { const { addr } = this.adrZP(); let v = this.read(addr!); const oldC = this.getFlag(C); const newC = (v & 0x80) !== 0; v = ((v << 1) | (oldC ? 1 : 0)) & 0xff; this.write(addr!, v); this.setFlag(C, newC); this.setZN(v); s.cycles += 5; break; } // ROL zp
      case 0x36: { const { addr } = this.adrZPX(); let v = this.read(addr!); const oldC = this.getFlag(C); const newC = (v & 0x80) !== 0; v = ((v << 1) | (oldC ? 1 : 0)) & 0xff; this.write(addr!, v); this.setFlag(C, newC); this.setZN(v); s.cycles += 6; break; } // ROL zp,X
      case 0x2E: { const { addr } = this.adrABS(); let v = this.read(addr!); const oldC = this.getFlag(C); const newC = (v & 0x80) !== 0; v = ((v << 1) | (oldC ? 1 : 0)) & 0xff; this.write(addr!, v); this.setFlag(C, newC); this.setZN(v); s.cycles += 6; break; } // ROL abs
      case 0x3E: { const { addr } = this.adrABSX(); let v = this.read(addr!); const oldC = this.getFlag(C); const newC = (v & 0x80) !== 0; v = ((v << 1) | (oldC ? 1 : 0)) & 0xff; this.write(addr!, v); this.setFlag(C, newC); this.setZN(v); s.cycles += 7; break; } // ROL abs,X
      case 0x66: { const { addr } = this.adrZP(); let v = this.read(addr!); const oldC = this.getFlag(C); const newC = (v & 0x01) !== 0; v = ((v >>> 1) | (oldC ? 0x80 : 0)) & 0xff; this.write(addr!, v); this.setFlag(C, newC); this.setZN(v); s.cycles += 5; break; } // ROR zp
      case 0x76: { const { addr } = this.adrZPX(); let v = this.read(addr!); const oldC = this.getFlag(C); const newC = (v & 0x01) !== 0; v = ((v >>> 1) | (oldC ? 0x80 : 0)) & 0xff; this.write(addr!, v); this.setFlag(C, newC); this.setZN(v); s.cycles += 6; break; } // ROR zp,X
      case 0x6E: { const { addr } = this.adrABS(); let v = this.read(addr!); const oldC = this.getFlag(C); const newC = (v & 0x01) !== 0; v = ((v >>> 1) | (oldC ? 0x80 : 0)) & 0xff; this.write(addr!, v); this.setFlag(C, newC); this.setZN(v); s.cycles += 6; break; } // ROR abs
      case 0x7E: { const { addr } = this.adrABSX(); let v = this.read(addr!); const oldC = this.getFlag(C); const newC = (v & 0x01) !== 0; v = ((v >>> 1) | (oldC ? 0x80 : 0)) & 0xff; this.write(addr!, v); this.setFlag(C, newC); this.setZN(v); s.cycles += 7; break; } // ROR abs,X

      // --- Unofficial RMW + ALU combos ---
      // SLO: (ASL mem) then ORA A
      case 0x03: { const { addr } = this.adrINDX(); let v = this.read(addr!); v = this.aslByte(v); this.write(addr!, v); s.a = (s.a | v) & 0xff; this.setZN(s.a); s.cycles += 8; break; }
      case 0x07: { const { addr } = this.adrZP();    let v = this.read(addr!); v = this.aslByte(v); this.write(addr!, v); s.a = (s.a | v) & 0xff; this.setZN(s.a); s.cycles += 5; break; }
      case 0x0F: { const { addr } = this.adrABS();   let v = this.read(addr!); v = this.aslByte(v); this.write(addr!, v); s.a = (s.a | v) & 0xff; this.setZN(s.a); s.cycles += 6; break; }
      case 0x13: { const { addr } = this.adrINDY(); let v = this.read(addr!); v = this.aslByte(v); this.write(addr!, v); s.a = (s.a | v) & 0xff; this.setZN(s.a); s.cycles += 8; break; }
      case 0x17: { const { addr } = this.adrZPX();   let v = this.read(addr!); v = this.aslByte(v); this.write(addr!, v); s.a = (s.a | v) & 0xff; this.setZN(s.a); s.cycles += 6; break; }
      case 0x1B: { const { addr } = this.adrABSY();  let v = this.read(addr!); v = this.aslByte(v); this.write(addr!, v); s.a = (s.a | v) & 0xff; this.setZN(s.a); s.cycles += 7; break; }
      case 0x1F: { const { addr } = this.adrABSX();  let v = this.read(addr!); v = this.aslByte(v); this.write(addr!, v); s.a = (s.a | v) & 0xff; this.setZN(s.a); s.cycles += 7; break; }
      // RLA: (ROL mem) then AND A
      case 0x23: { const { addr } = this.adrINDX(); let v = this.read(addr!); v = this.rolByte(v); this.write(addr!, v); s.a = (s.a & v) & 0xff; this.setZN(s.a); s.cycles += 8; break; }
      case 0x27: { const { addr } = this.adrZP();    let v = this.read(addr!); v = this.rolByte(v); this.write(addr!, v); s.a = (s.a & v) & 0xff; this.setZN(s.a); s.cycles += 5; break; }
      case 0x2F: { const { addr } = this.adrABS();   let v = this.read(addr!); v = this.rolByte(v); this.write(addr!, v); s.a = (s.a & v) & 0xff; this.setZN(s.a); s.cycles += 6; break; }
      case 0x33: { const { addr } = this.adrINDY(); let v = this.read(addr!); v = this.rolByte(v); this.write(addr!, v); s.a = (s.a & v) & 0xff; this.setZN(s.a); s.cycles += 8; break; }
      case 0x37: { const { addr } = this.adrZPX();   let v = this.read(addr!); v = this.rolByte(v); this.write(addr!, v); s.a = (s.a & v) & 0xff; this.setZN(s.a); s.cycles += 6; break; }
      case 0x3B: { const { addr } = this.adrABSY();  let v = this.read(addr!); v = this.rolByte(v); this.write(addr!, v); s.a = (s.a & v) & 0xff; this.setZN(s.a); s.cycles += 7; break; }
      case 0x3F: { const { addr } = this.adrABSX();  let v = this.read(addr!); v = this.rolByte(v); this.write(addr!, v); s.a = (s.a & v) & 0xff; this.setZN(s.a); s.cycles += 7; break; }
      // SRE: (LSR mem) then EOR A
      case 0x43: { const { addr } = this.adrINDX(); let v = this.read(addr!); v = this.lsrByte(v); this.write(addr!, v); s.a = (s.a ^ v) & 0xff; this.setZN(s.a); s.cycles += 8; break; }
      case 0x47: { const { addr } = this.adrZP();    let v = this.read(addr!); v = this.lsrByte(v); this.write(addr!, v); s.a = (s.a ^ v) & 0xff; this.setZN(s.a); s.cycles += 5; break; }
      case 0x4F: { const { addr } = this.adrABS();   let v = this.read(addr!); v = this.lsrByte(v); this.write(addr!, v); s.a = (s.a ^ v) & 0xff; this.setZN(s.a); s.cycles += 6; break; }
      case 0x53: { const { addr } = this.adrINDY(); let v = this.read(addr!); v = this.lsrByte(v); this.write(addr!, v); s.a = (s.a ^ v) & 0xff; this.setZN(s.a); s.cycles += 8; break; }
      case 0x57: { const { addr } = this.adrZPX();   let v = this.read(addr!); v = this.lsrByte(v); this.write(addr!, v); s.a = (s.a ^ v) & 0xff; this.setZN(s.a); s.cycles += 6; break; }
      case 0x5B: { const { addr } = this.adrABSY();  let v = this.read(addr!); v = this.lsrByte(v); this.write(addr!, v); s.a = (s.a ^ v) & 0xff; this.setZN(s.a); s.cycles += 7; break; }
      case 0x5F: { const { addr } = this.adrABSX();  let v = this.read(addr!); v = this.lsrByte(v); this.write(addr!, v); s.a = (s.a ^ v) & 0xff; this.setZN(s.a); s.cycles += 7; break; }
      // RRA: (ROR mem) then ADC
      case 0x63: { const { addr } = this.adrINDX(); let v = this.read(addr!); v = this.rorByte(v); this.write(addr!, v); this.adc(v); s.cycles += 8; break; }
      case 0x67: { const { addr } = this.adrZP();    let v = this.read(addr!); v = this.rorByte(v); this.write(addr!, v); this.adc(v); s.cycles += 5; break; }
      case 0x6F: { const { addr } = this.adrABS();   let v = this.read(addr!); v = this.rorByte(v); this.write(addr!, v); this.adc(v); s.cycles += 6; break; }
      case 0x73: { const { addr } = this.adrINDY(); let v = this.read(addr!); v = this.rorByte(v); this.write(addr!, v); this.adc(v); s.cycles += 8; break; }
      case 0x77: { const { addr } = this.adrZPX();   let v = this.read(addr!); v = this.rorByte(v); this.write(addr!, v); this.adc(v); s.cycles += 6; break; }
      case 0x7B: { const { addr } = this.adrABSY();  let v = this.read(addr!); v = this.rorByte(v); this.write(addr!, v); this.adc(v); s.cycles += 7; break; }
      case 0x7F: { const { addr } = this.adrABSX();  let v = this.read(addr!); v = this.rorByte(v); this.write(addr!, v); this.adc(v); s.cycles += 7; break; }
      // DCP: (DEC mem) then CMP
      case 0xC3: { const { addr } = this.adrINDX(); let v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.cmp(s.a, v); s.cycles += 8; break; }
      case 0xC7: { const { addr } = this.adrZP();    let v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.cmp(s.a, v); s.cycles += 5; break; }
      case 0xCF: { const { addr } = this.adrABS();   let v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.cmp(s.a, v); s.cycles += 6; break; }
      case 0xD3: { const { addr } = this.adrINDY(); let v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.cmp(s.a, v); s.cycles += 8; break; }
      case 0xD7: { const { addr } = this.adrZPX();   let v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.cmp(s.a, v); s.cycles += 6; break; }
      case 0xDB: { const { addr } = this.adrABSY();  let v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.cmp(s.a, v); s.cycles += 7; break; }
      case 0xDF: { const { addr } = this.adrABSX();  let v = (this.read(addr!) - 1) & 0xff; this.write(addr!, v); this.cmp(s.a, v); s.cycles += 7; break; }
      // ISB/ISC: (INC mem) then SBC
      case 0xE3: { const { addr } = this.adrINDX(); let v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.sbc(v); s.cycles += 8; break; }
      case 0xE7: { const { addr } = this.adrZP();    let v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.sbc(v); s.cycles += 5; break; }
      case 0xEF: { const { addr } = this.adrABS();   let v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.sbc(v); s.cycles += 6; break; }
      case 0xF3: { const { addr } = this.adrINDY(); let v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.sbc(v); s.cycles += 8; break; }
      case 0xF7: { const { addr } = this.adrZPX();   let v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.sbc(v); s.cycles += 6; break; }
      case 0xFB: { const { addr } = this.adrABSY();  let v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.sbc(v); s.cycles += 7; break; }
      case 0xFF: { const { addr } = this.adrABSX();  let v = (this.read(addr!) + 1) & 0xff; this.write(addr!, v); this.sbc(v); s.cycles += 7; break; }
      // BIT
      case 0x24: { const { addr } = this.adrZP(); const v = this.read(addr!); this.setFlag(Z, (s.a & v) === 0); this.setFlag(V, (v & 0x40) !== 0); this.setFlag(N, (v & 0x80) !== 0); s.cycles += 3; break; }
      case 0x2C: { const { addr } = this.adrABS(); const v = this.read(addr!); this.setFlag(Z, (s.a & v) === 0); this.setFlag(V, (v & 0x40) !== 0); this.setFlag(N, (v & 0x80) !== 0); s.cycles += 4; break; }
      // Unofficial: BIT #imm (0x89) sets Z like BIT; N,V unaffected
      case 0x89: { const { value } = this.adrIMM(); const v = value!; this.setFlag(Z, (s.a & v) === 0); s.cycles += 2; break; }
      // CMP/CPX/CPY
      case 0xC9: { const { value } = this.adrIMM(); this.cmp(s.a, value!); s.cycles += 2; break; }
      case 0xC5: { const { addr } = this.adrZP(); this.cmp(s.a, this.read(addr!)); s.cycles += 3; break; }
      case 0xD5: { const { addr } = this.adrZPX(); this.cmp(s.a, this.read(addr!)); s.cycles += 4; break; }
      case 0xCD: { const { addr } = this.adrABS(); this.cmp(s.a, this.read(addr!)); s.cycles += 4; break; }
      case 0xDD: { const { addr, crossed } = this.adrABSX(); this.cmp(s.a, this.read(addr!)); s.cycles += 4 + (crossed ? 1 : 0); break; }
      case 0xD9: { const { addr, crossed } = this.adrABSY(); this.cmp(s.a, this.read(addr!)); s.cycles += 4 + (crossed ? 1 : 0); break; }
      case 0xC1: { const { addr } = this.adrINDX(); this.cmp(s.a, this.read(addr!)); s.cycles += 6; break; }
      case 0xD1: { const { addr, crossed } = this.adrINDY(); this.cmp(s.a, this.read(addr!)); s.cycles += 5 + (crossed ? 1 : 0); break; }
      case 0xE0: { const { value } = this.adrIMM(); this.cmp(s.x, value!); s.cycles += 2; break; } // CPX
      case 0xE4: { const { addr } = this.adrZP(); this.cmp(s.x, this.read(addr!)); s.cycles += 3; break; }
      case 0xEC: { const { addr } = this.adrABS(); this.cmp(s.x, this.read(addr!)); s.cycles += 4; break; }
      case 0xC0: { const { value } = this.adrIMM(); this.cmp(s.y, value!); s.cycles += 2; break; } // CPY
      case 0xC4: { const { addr } = this.adrZP(); this.cmp(s.y, this.read(addr!)); s.cycles += 3; break; }
      case 0xCC: { const { addr } = this.adrABS(); this.cmp(s.y, this.read(addr!)); s.cycles += 4; break; }
      // Flag ops
      case 0x18: this.setFlag(C, false); s.cycles += 2; break; // CLC
      case 0x38: this.setFlag(C, true); s.cycles += 2; break; // SEC
      case 0x58: this.setFlag(I, false); s.cycles += 2; break; // CLI
      case 0x78: this.setFlag(I, true); s.cycles += 2; break; // SEI
      case 0xB8: this.setFlag(V, false); s.cycles += 2; break; // CLV
      case 0xD8: this.setFlag(D, false); s.cycles += 2; break; // CLD
      case 0xF8: this.setFlag(D, true); s.cycles += 2; break; // SED
      // Branches
      case 0x90: { // BCC
        const off = (this.fetch8() << 24) >> 24; let cy = 2; if (!this.getFlag(C)) { const old = s.pc; s.pc = (s.pc + off) & 0xffff; cy++; if ((old & 0xff00) !== (s.pc & 0xff00)) cy++; } s.cycles += cy; break;
      }
      case 0xB0: { // BCS
        const off = (this.fetch8() << 24) >> 24; let cy = 2; if (this.getFlag(C)) { const old = s.pc; s.pc = (s.pc + off) & 0xffff; cy++; if ((old & 0xff00) !== (s.pc & 0xff00)) cy++; } s.cycles += cy; break;
      }
      case 0xF0: { // BEQ
        const off = (this.fetch8() << 24) >> 24; let cy = 2; if (this.getFlag(Z)) { const old = s.pc; s.pc = (s.pc + off) & 0xffff; cy++; if ((old & 0xff00) !== (s.pc & 0xff00)) cy++; } s.cycles += cy; break;
      }
      case 0xD0: { // BNE
        const off = (this.fetch8() << 24) >> 24; let cy = 2; if (!this.getFlag(Z)) { const old = s.pc; s.pc = (s.pc + off) & 0xffff; cy++; if ((old & 0xff00) !== (s.pc & 0xff00)) cy++; } s.cycles += cy; break;
      }
      case 0x10: { // BPL
        const off = (this.fetch8() << 24) >> 24; let cy = 2; if (!this.getFlag(N)) { const old = s.pc; s.pc = (s.pc + off) & 0xffff; cy++; if ((old & 0xff00) !== (s.pc & 0xff00)) cy++; } s.cycles += cy; break;
      }
      case 0x30: { // BMI
        const off = (this.fetch8() << 24) >> 24; let cy = 2; if (this.getFlag(N)) { const old = s.pc; s.pc = (s.pc + off) & 0xffff; cy++; if ((old & 0xff00) !== (s.pc & 0xff00)) cy++; } s.cycles += cy; break;
      }
      case 0x50: { // BVC
        const off = (this.fetch8() << 24) >> 24; let cy = 2; if (!this.getFlag(V)) { const old = s.pc; s.pc = (s.pc + off) & 0xffff; cy++; if ((old & 0xff00) !== (s.pc & 0xff00)) cy++; } s.cycles += cy; break;
      }
      case 0x70: { // BVS
        const off = (this.fetch8() << 24) >> 24; let cy = 2; if (this.getFlag(V)) { const old = s.pc; s.pc = (s.pc + off) & 0xffff; cy++; if ((old & 0xff00) !== (s.pc & 0xff00)) cy++; } s.cycles += cy; break;
      }
      // Jumps/subroutines
      case 0x4C: { const { addr } = this.adrABS(); s.pc = addr!; s.cycles += 3; break; } // JMP abs
      case 0x6C: { const { addr } = this.adrIND(); s.pc = addr!; s.cycles += 5; break; } // JMP ind
      case 0x20: { const addr = this.fetch16(); const ret = (s.pc - 1) & 0xffff; this.push16(ret); s.pc = addr; s.cycles += 6; break; } // JSR
      case 0x60: { const addr = (this.pop16() + 1) & 0xffff; s.pc = addr; s.cycles += 6; break; } // RTS
      // BRK/RTI (basic)
      case 0x00: { // BRK
        s.pc = (s.pc + 1) & 0xffff; // increment by one (emulated quirk)
        this.push16((s.pc - 1) & 0xffff);
        this.push8((s.p | B | U) & 0xff);
        this.setFlag(I, true);
        const vec = this.read16(0xfffe);
        s.pc = vec;
        s.cycles += 7;
        break;
      }
      case 0x40: { // RTI
        s.p = (this.pop8() & ~B) | U;
        s.pc = this.pop16();
        s.cycles += 6;
        break;
      }
      // Unofficial NOPs commonly used by test ROMs (treat as NOP with proper read timing)
      case 0x1A: case 0x3A: case 0x5A: case 0x7A: case 0xDA: case 0xFA: // 1-byte NOP
        s.cycles += 2; break;
      // Unstable: XAA (#imm) approximated as A = X & imm
      case 0x8B: { const { value } = this.adrIMM(); s.a = s.x & value!; this.setZN(s.a); s.cycles += 2; break; }
      // Unofficial: AXS/SBX (#imm) = X = (A & X) - imm; C set as (A&X)>=imm
      case 0xCB: { const { value } = this.adrIMM(); const t = (s.a & s.x) & 0xff; const imm = value!; const res = (t - imm) & 0xff; this.setFlag(C, t >= imm); s.x = res; this.setZN(s.x); s.cycles += 2; break; }
      case 0x80: case 0x82: case 0xC2: case 0xE2: { this.fetch8(); s.cycles += 2; break; } // NOP #imm (2-byte variants)
      case 0x04: case 0x44: case 0x64: { this.adrZP(); s.cycles += 3; break; } // NOP zp
      case 0x14: case 0x34: case 0x54: case 0x74: case 0xD4: case 0xF4: { this.adrZPX(); s.cycles += 4; break; } // NOP zp,X
      case 0x0C: { this.adrABS(); s.cycles += 4; break; } // NOP abs
      case 0x1C: case 0x3C: case 0x5C: case 0x7C: case 0xDC: case 0xFC: { const { crossed } = this.adrABSX(); s.cycles += 4 + (crossed ? 1 : 0); break; } // NOP abs,X
      
      // KIL/JAM opcodes (unofficial): configurable behavior
      case 0x02: case 0x12: case 0x22: case 0x32: case 0x42: case 0x52: case 0x62: case 0x72: case 0x92: case 0xB2: case 0xD2: case 0xF2:
        if (this.illegalMode === 'strict') { this.jammed = true; return; } else { s.cycles += 2; break; }

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
  }
}
