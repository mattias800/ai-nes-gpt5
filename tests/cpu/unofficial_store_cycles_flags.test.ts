import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

const C=1<<0, Z=1<<1, N=1<<7;
const getF=(p:number,m:number)=> (p & m)!==0;

// Additional cycle/flag coverage for unofficial store/stack opcodes

describe('CPU unofficial stores/stack: cycles and flags', () => {
  it('LAS abs,Y (0xBB): sets A,X,S=(mem&S); Z/N from A; 4(+1 if cross) cycles', () => {
    const { cpu, bus } = cpuWithProgram([
      0xBB, 0x00, 0x90, // LAS $9000,Y
    ], 0x8000);
    cpu.state.s = 0xF0;
    cpu.state.y = 0x00; // no page cross
    bus.write(0x9000, 0x00);
    const c0 = cpu.state.cycles;
    cpu.step();
    expect(cpu.state.a).toBe(0x00 & 0xF0);
    expect(cpu.state.x).toBe(0x00 & 0xF0);
    expect(cpu.state.s).toBe(0x00 & 0xF0);
    expect(getF(cpu.state.p, Z)).toBe(true);
    expect(getF(cpu.state.p, N)).toBe(false);
    expect(cpu.state.cycles - c0).toBe(4);
  });

  it('TAS/SHS abs,Y (0x9B): S=A&X; store (S & (high(addr)+1)); 5 cycles; flags unchanged', () => {
    const { cpu, bus } = cpuWithProgram([
      0x9B, 0x00, 0x90, // TAS $9000,Y
    ], 0x8000);
    cpu.state.a = 0xAA; cpu.state.x = 0x0F; cpu.state.y = 0x10;
    cpu.state.p = 0xCD; // sticky flags
    const c0 = cpu.state.cycles;
    cpu.step();
    const addr = (0x9000 + 0x10) & 0xFFFF;
    const high = (((addr >> 8) & 0xFF) + 1) & 0xFF;
    const expectVal = (cpu.state.s & high) & 0xFF; // s was set to a&x inside opcode
    expect(bus.read(addr)).toBe(expectVal);
    expect(cpu.state.cycles - c0).toBe(5);
    expect(cpu.state.p).toBe(0xCD);
  });

  it('SHY abs,X (0x9C): store (Y & (high(addr)+1)); 5 cycles; flags unchanged', () => {
    const { cpu, bus } = cpuWithProgram([
      0x9C, 0x00, 0x90, // SHY $9000,X
    ], 0x8000);
    cpu.state.y = 0x55; cpu.state.x = 0x23;
    cpu.state.p = 0x77;
    const c0 = cpu.state.cycles;
    cpu.step();
    const addr = (0x9000 + 0x23) & 0xFFFF;
    const high = (((addr >> 8) & 0xFF) + 1) & 0xFF;
    expect(bus.read(addr)).toBe(0x55 & high);
    expect(cpu.state.cycles - c0).toBe(5);
    expect(cpu.state.p).toBe(0x77);
  });

  it('SHX abs,Y (0x9E): store (X & (high(addr)+1)); 5 cycles; flags unchanged', () => {
    const { cpu, bus } = cpuWithProgram([
      0x9E, 0x00, 0x90, // SHX $9000,Y
    ], 0x8000);
    cpu.state.x = 0xCC; cpu.state.y = 0x30;
    cpu.state.p = 0xF5;
    const c0 = cpu.state.cycles;
    cpu.step();
    const addr = (0x9000 + 0x30) & 0xFFFF;
    const high = (((addr >> 8) & 0xFF) + 1) & 0xFF;
    expect(bus.read(addr)).toBe(0xCC & high);
    expect(cpu.state.cycles - c0).toBe(5);
    expect(cpu.state.p).toBe(0xF5);
  });

  it('SHA/AHX (zp),Y (0x93): store (A & X & (high(addr)+1)); 6 cycles; flags unchanged', () => {
    const { cpu, bus } = cpuWithProgram([
      0x93, 0x10, // SHA ($10),Y
    ], 0x8000);
    bus.write(0x0010, 0x34); bus.write(0x0011, 0x12); // ptr -> $1234
    cpu.state.a = 0xF0; cpu.state.x = 0x0F; cpu.state.y = 0x40;
    cpu.state.p = 0xAA;
    const c0 = cpu.state.cycles;
    cpu.step();
    const base = 0x1234;
    const addr = (base + 0x40) & 0xFFFF;
    const high = (((addr >> 8) & 0xFF) + 1) & 0xFF;
    expect(bus.read(addr)).toBe((0xF0 & 0x0F) & high);
    expect(cpu.state.cycles - c0).toBe(6);
    expect(cpu.state.p).toBe(0xAA);
  });
});

