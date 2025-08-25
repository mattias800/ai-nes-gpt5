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
  constructor(private bus: CPUBus) {
    this.state = { a: 0, x: 0, y: 0, s: 0xfd, pc: 0, p: 0x24, cycles: 0 };
  }

  reset(vector: Word) {
    this.state = { a: 0, x: 0, y: 0, s: 0xfd, pc: vector & 0xffff, p: 0x24, cycles: 0 };
  }

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
  private sbc(val: Byte) {
    // NES in binary mode: A = A - val - (1-C)
    this.adc((val ^ 0xff) & 0xff);
  }

  step(): void {
    const opcode = this.fetch8();
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
      case 0x29: { const { value } = this.adrIMM(); s.a = s.a & value!; this.setZN(s.a); s.cycles += 2; break; }
      case 0x25: { const { addr } = this.adrZP(); s.a = s.a & this.read(addr!); this.setZN(s.a); s.cycles += 3; break; }
      case 0x2D: { const { addr } = this.adrABS(); s.a = s.a & this.read(addr!); this.setZN(s.a); s.cycles += 4; break; }
      case 0x09: { const { value } = this.adrIMM(); s.a = s.a | value!; this.setZN(s.a); s.cycles += 2; break; }
      case 0x05: { const { addr } = this.adrZP(); s.a = s.a | this.read(addr!); this.setZN(s.a); s.cycles += 3; break; }
      case 0x0D: { const { addr } = this.adrABS(); s.a = s.a | this.read(addr!); this.setZN(s.a); s.cycles += 4; break; }
      case 0x49: { const { value } = this.adrIMM(); s.a = s.a ^ value!; this.setZN(s.a); s.cycles += 2; break; }
      case 0x45: { const { addr } = this.adrZP(); s.a = s.a ^ this.read(addr!); this.setZN(s.a); s.cycles += 3; break; }
      case 0x4D: { const { addr } = this.adrABS(); s.a = s.a ^ this.read(addr!); this.setZN(s.a); s.cycles += 4; break; }
      // ADC/SBC
      case 0x69: { const { value } = this.adrIMM(); this.adc(value!); s.cycles += 2; break; }
      case 0x65: { const { addr } = this.adrZP(); this.adc(this.read(addr!)); s.cycles += 3; break; }
      case 0x6D: { const { addr } = this.adrABS(); this.adc(this.read(addr!)); s.cycles += 4; break; }
      case 0xE9: case 0xEB: { const { value } = this.adrIMM(); this.sbc(value!); s.cycles += 2; break; }
      case 0xE5: { const { addr } = this.adrZP(); this.sbc(this.read(addr!)); s.cycles += 3; break; }
      case 0xED: { const { addr } = this.adrABS(); this.sbc(this.read(addr!)); s.cycles += 4; break; }
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
      case 0x0A: { const c = (s.a & 0x80) !== 0; s.a = (s.a << 1) & 0xff; this.setFlag(C, c); this.setZN(s.a); s.cycles += 2; break; } // ASL A
      case 0x4A: { const c = (s.a & 0x01) !== 0; s.a = (s.a >>> 1) & 0xff; this.setFlag(C, c); this.setZN(s.a); s.cycles += 2; break; } // LSR A
      case 0x2A: { const c = this.getFlag(C); const newC = (s.a & 0x80) !== 0; s.a = ((s.a << 1) | (c ? 1 : 0)) & 0xff; this.setFlag(C, newC); this.setZN(s.a); s.cycles += 2; break; } // ROL A
      case 0x6A: { const c = this.getFlag(C); const newC = (s.a & 0x01) !== 0; s.a = ((s.a >>> 1) | (c ? 0x80 : 0)) & 0xff; this.setFlag(C, newC); this.setZN(s.a); s.cycles += 2; break; } // ROR A
      // BIT
      case 0x24: { const { addr } = this.adrZP(); const v = this.read(addr!); this.setFlag(Z, (s.a & v) === 0); this.setFlag(V, (v & 0x40) !== 0); this.setFlag(N, (v & 0x80) !== 0); s.cycles += 3; break; }
      case 0x2C: { const { addr } = this.adrABS(); const v = this.read(addr!); this.setFlag(Z, (s.a & v) === 0); this.setFlag(V, (v & 0x40) !== 0); this.setFlag(N, (v & 0x80) !== 0); s.cycles += 4; break; }
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
      default:
        throw new Error(`Opcode not implemented: $${opcode.toString(16)}`);
    }
  }
}
