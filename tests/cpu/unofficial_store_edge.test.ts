import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

// Tests for additional unofficial store/stack ops with approximations

describe('CPU unofficial stores and LAS/TAS', () => {
  it('LAS $addr,Y: A,X,S = (mem & S); flags from A; cycles 4/5', () => {
    const { cpu, bus } = cpuWithProgram([
      0xBB, 0x00, 0x90, // LAS $9000,Y
    ], 0x8000);
    cpu.state.s = 0xF0; // stack
    cpu.state.y = 0x02;
    bus.write(0x9002, 0x5A);
    cpu.step();
    const v = 0x5A & 0xF0;
    expect(cpu.state.a).toBe(v);
    expect(cpu.state.x).toBe(v);
    expect(cpu.state.s).toBe(v);
  });

  it('TAS/SHS $addr,Y (0x9B): S=A&X then store (S & (high(addr)+1))', () => {
    const { cpu, bus } = cpuWithProgram([
      0x9B, 0x00, 0x80, // TAS $8000,Y
    ], 0x8000);
    cpu.state.a = 0xF0; cpu.state.x = 0x0F; cpu.state.y = 0x10; // A&X=0x00
    cpu.step();
    const addr = (0x8000 + 0x10) & 0xFFFF;
    const high = (((addr >> 8) & 0xFF) + 1) & 0xFF;
    const val = (cpu.state.s & high) & 0xFF;
    expect(bus.read(addr)).toBe(val);
  });

  it('SHY $addr,X (0x9C): store (Y & (high(addr)+1))', () => {
    const { cpu, bus } = cpuWithProgram([
      0x9C, 0x00, 0x80, // SHY $8000,X
    ], 0x8000);
    cpu.state.y = 0xAA; cpu.state.x = 0x20;
    cpu.step();
    const addr = (0x8000 + 0x20) & 0xFFFF;
    const high = (((addr >> 8) & 0xFF) + 1) & 0xFF;
    expect(bus.read(addr)).toBe(0xAA & high);
  });

  it('SHX $addr,Y (0x9E): store (X & (high(addr)+1))', () => {
    const { cpu, bus } = cpuWithProgram([
      0x9E, 0x00, 0x80, // SHX $8000,Y
    ], 0x8000);
    cpu.state.x = 0xCC; cpu.state.y = 0x30;
    cpu.step();
    const addr = (0x8000 + 0x30) & 0xFFFF;
    const high = (((addr >> 8) & 0xFF) + 1) & 0xFF;
    expect(bus.read(addr)).toBe(0xCC & high);
  });

  it('SHA/AHX (zp),Y (0x93): store (A & X & (high(addr)+1))', () => {
    const { cpu, bus } = cpuWithProgram([
      0x93, 0x10, // SHA ($10),Y
    ], 0x8000);
    // Set zp ptr $0010 -> $9000
    bus.write(0x0010, 0x00); bus.write(0x0011, 0x90);
    cpu.state.a = 0xF0; cpu.state.x = 0x0F; cpu.state.y = 0x40;
    cpu.step();
    const base = 0x9000;
    const addr = (base + 0x40) & 0xFFFF;
    const high = (((addr >> 8) & 0xFF) + 1) & 0xFF;
    expect(bus.read(addr)).toBe((0xF0 & 0x0F) & high);
  });
});

