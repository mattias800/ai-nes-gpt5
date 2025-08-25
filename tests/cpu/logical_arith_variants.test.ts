import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

describe('CPU: logical/arithmetic variants across addressing modes', () => {
  it('ORA/AND/EOR absolute,X and (indirect),Y update A and flags', () => {
    const { cpu, bus } = cpuWithProgram([
      // ORA $1234,X with X=1; memory $1235=0x0F
      0xA2, 0x01, // LDX #$01
      0x1D, 0x34, 0x12, // ORA $1234,X
      // AND ($80),Y with Y=2; memory ZP $80/$81 -> $2000; memory $2002=0xF0
      0xA0, 0x02, // LDY #$02
      0x31, 0x80, // AND ($80),Y
      // EOR $10
      0x45, 0x10, // EOR $10
    ]);
    // Seed memory
    bus.write(0x1235, 0x0F);
    bus.write(0x0080, 0x00); bus.write(0x0081, 0x20);
    bus.write(0x2002, 0xF0);
    bus.write(0x0010, 0xFF);

    // Execute
    for (let i=0;i<6;i++) cpu.step();
    // After ORA: A=0x0F
    // After AND: A=0x0F & 0xF0 = 0x00 -> Z=1
    // After EOR with 0xFF: A=0xFF -> N=1
    expect(cpu.state.a).toBe(0xFF);
    expect((cpu.state.p & 0x02) !== 0).toBe(false); // Z cleared after EOR
    expect((cpu.state.p & 0x80) !== 0).toBe(true); // N set
  });

  it('ADC/SBC variants set C and V appropriately on page cross', () => {
    const { cpu, bus } = cpuWithProgram([
      0xA9, 0x7F,       // LDA #$7F
      0x7D, 0xFF, 0x00, // ADC $00FF,X (X=1) -> reads $0100
      0xE9, 0x01,       // SBC #$01
    ]);
    // Set X=1 via bus trick (write then TAX)
    // Instead, modify CPU state with instruction: LDX #$01
    // Insert after LDA (but to keep indices simple, manually set X here)
    cpu.state.x = 0x01;
    bus.write(0x0100, 0x01);

    cpu.step(); // LDA
    cpu.step(); // ADC -> 0x7F + 0x01 = 0x80, V set
    expect(cpu.state.a).toBe(0x80);
    expect((cpu.state.p & 0x40) !== 0).toBe(true); // V
    cpu.step(); // SBC #1 with C=0 subtracts 2 -> 0x7E
    expect(cpu.state.a).toBe(0x7E);
    // Carry indicates no borrow after SBC
    expect((cpu.state.p & 0x01) !== 0).toBe(true);
  });
});
