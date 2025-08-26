import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

function getFlag(p: number, mask: number) { return (p & mask) !== 0; }
const C = 1<<0, Z=1<<1, N=1<<7;

describe('CPU unofficial opcodes: basic behavior and timing', () => {
  it('LAX zp loads A and X and sets Z/N; 3 cycles', () => {
    const { cpu, bus } = cpuWithProgram([
      0xA7, 0x10, // LAX $10
    ], 0x8000);
    bus.write(0x0010, 0x80);
    cpu.step();
    expect(cpu.state.a).toBe(0x80);
    expect(cpu.state.x).toBe(0x80);
    expect(getFlag(cpu.state.p, N)).toBe(true);
    expect(getFlag(cpu.state.p, Z)).toBe(false);
    expect(cpu.state.cycles).toBe(3);
  });

  it('SAX zp stores A&X; 3 cycles', () => {
    const { cpu, bus } = cpuWithProgram([
      0x87, 0x12, // SAX $12
    ], 0x8000);
    cpu.state.a = 0xF0; cpu.state.x = 0x0F;
    cpu.step();
    expect(bus.read(0x0012)).toBe(0x00);
    expect(cpu.state.cycles).toBe(3);
  });

  it('SLO zp: (ASL mem) then ORA A; 5 cycles', () => {
    const { cpu, bus } = cpuWithProgram([
      0x07, 0x20, // SLO $20
    ], 0x8000);
    bus.write(0x0020, 0x40);
    cpu.state.a = 0x01;
    cpu.step();
    // mem 0x40 -> ASL 0x80, C=0
    expect(bus.read(0x0020)).toBe(0x80);
    expect(cpu.state.a).toBe(0x81);
    expect(cpu.state.cycles).toBe(5);
  });

  it('RLA zp: (ROL mem) then AND A; 5 cycles', () => {
    const { cpu, bus } = cpuWithProgram([
      0x27, 0x30, // RLA $30
    ], 0x8000);
    bus.write(0x0030, 0x80);
    cpu.state.a = 0xFF; // AND will produce ROL(mem)
    cpu.state.p &= ~C; // C=0 so ROL 0x80 -> 0x00, C=1
    cpu.step();
    expect(bus.read(0x0030)).toBe(0x00);
    expect(cpu.state.a).toBe(0x00);
    expect(getFlag(cpu.state.p, Z)).toBe(true);
    expect(cpu.state.cycles).toBe(5);
  });

  it('SRE zp: (LSR mem) then EOR A; 5 cycles', () => {
    const { cpu, bus } = cpuWithProgram([
      0x47, 0x40, // SRE $40
    ], 0x8000);
    bus.write(0x0040, 0x01);
    cpu.state.a = 0xAA;
    cpu.step();
    expect(bus.read(0x0040)).toBe(0x00); // LSR 1 -> 0
    expect(cpu.state.a).toBe(0xAA ^ 0x00);
    expect(getFlag(cpu.state.p, C)).toBe(true);
    expect(cpu.state.cycles).toBe(5);
  });

  it('RRA zp: (ROR mem) then ADC; 5 cycles', () => {
    const { cpu, bus } = cpuWithProgram([
      0x67, 0x50, // RRA $50
    ], 0x8000);
    bus.write(0x0050, 0x01);
    cpu.state.a = 0x7F; // 127
    cpu.state.p |= C; // carry in ignored by ROR, but ADC will use C after ROR
    cpu.step();
    // ROR 0x01 -> 0x80, C=1; then ADC 0x80 with carry-in 1: 0x7F + 0x80 + 1 = 0x100 -> 0x00, C=1, V changes
    expect(bus.read(0x0050)).toBe(0x80);
    expect(cpu.state.a & 0xFF).toBe(0x00);
    expect(getFlag(cpu.state.p, C)).toBe(true);
    expect(getFlag(cpu.state.p, Z)).toBe(true);
    expect(cpu.state.cycles).toBe(5);
  });

  it('DCP zp: (DEC mem) then CMP; 5 cycles', () => {
    const { cpu, bus } = cpuWithProgram([
      0xC7, 0x60, // DCP $60
    ], 0x8000);
    bus.write(0x0060, 0x01);
    cpu.state.a = 0x00;
    cpu.step();
    expect(bus.read(0x0060)).toBe(0x00);
    expect(getFlag(cpu.state.p, Z)).toBe(true);
    expect(getFlag(cpu.state.p, C)).toBe(true);
    expect(cpu.state.cycles).toBe(5);
  });

  it('ISB zp: (INC mem) then SBC; 5 cycles', () => {
    const { cpu, bus } = cpuWithProgram([
      0xE7, 0x70, // ISB $70
    ], 0x8000);
    bus.write(0x0070, 0xFF);
    cpu.state.a = 0x10;
    cpu.state.p |= C; // carry set -> subtract 0 without borrow
    cpu.step();
    expect(bus.read(0x0070)).toBe(0x00);
    expect(cpu.state.a).toBe(0x10);
    expect(cpu.state.cycles).toBe(5);
  });
});

