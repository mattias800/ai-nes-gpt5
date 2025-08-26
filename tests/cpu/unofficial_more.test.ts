import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

const C=1<<0, Z=1<<1, V=1<<6, N=1<<7;
const getF=(p:number,m:number)=> (p & m)!==0;

describe('CPU unofficial opcodes (additional)', () => {
  it('ANC #imm: AND then C = bit7(result)', () => {
    const { cpu } = cpuWithProgram([
      0x0B, 0xFF, // ANC #$FF
    ], 0x8000);
    cpu.state.a = 0x81;
    cpu.step();
    expect(cpu.state.a).toBe(0x81);
    expect(getF(cpu.state.p,N)).toBe(true);
    expect(getF(cpu.state.p,C)).toBe(true);
  });

  it('ALR #imm: (A & imm) >> 1; C=bit0(pre)', () => {
    const { cpu } = cpuWithProgram([
      0x4B, 0x02, // ALR #$02
    ], 0x8000);
    cpu.state.a = 0x03;
    cpu.step();
    expect(cpu.state.a).toBe(0x01);
    expect(getF(cpu.state.p,C)).toBe(false);
  });

  it('ARR #imm: (A & imm) ROR; C from bit6, V from bit6^bit5', () => {
    const { cpu } = cpuWithProgram([
      0x6B, 0xFF, // ARR #$FF
    ], 0x8000);
    cpu.state.a = 0x80;
    cpu.state.p |= C; // carry in
    cpu.step();
    expect(cpu.state.a).toBe(0xC0);
    expect(getF(cpu.state.p,C)).toBe(true);
    expect(getF(cpu.state.p,V)).toBe(true);
  });

  it('AXS/SBX #imm: X=(A&X)-imm; C=t>=imm', () => {
    const { cpu } = cpuWithProgram([
      0xCB, 0x05, // AXS #$05
    ], 0x8000);
    cpu.state.a = 0x0F; cpu.state.x = 0x08;
    cpu.step();
    expect(cpu.state.x).toBe(0x03);
    expect(getF(cpu.state.p,C)).toBe(true);
  });

  it('XAA #imm: approx A = X & imm', () => {
    const { cpu } = cpuWithProgram([
      0x8B, 0xF0, // XAA #$F0
    ], 0x8000);
    cpu.state.x = 0x0F;
    cpu.step();
    expect(cpu.state.a).toBe(0x00);
    expect(getF(cpu.state.p,Z)).toBe(true);
  });
});

