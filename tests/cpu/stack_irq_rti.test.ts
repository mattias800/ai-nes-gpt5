import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

// Verify JSR/RTS nesting, BRK/RTI vectors, and IRQ push/pop PC/P semantics.

describe('CPU stack and interrupt control flow', () => {
  it('JSR/RTS returns to caller (single level)', () => {
    // $8000: JSR $8005; NOP; NOP; RTS (at $8005)
    const prog = [0x20, 0x05, 0x80, 0xEA, 0xEA, 0x60];
    const { cpu, bus } = cpuWithProgram(prog, 0x8000);
    cpu.step(); // JSR
    expect(cpu.state.pc).toBe(0x8005);
    cpu.step(); // RTS
    expect(cpu.state.pc).toBe(0x8003); // return to next after JSR operand (JSR is 3 bytes)
  });

  it('nested JSR/RTS returns correctly', () => {
    // Layout:
    // $8000: JSR $8005; NOP; NOP
    // $8005: JSR $800A; RTS
    // $800A: RTS
    const prog = [
      0x20, 0x05, 0x80, 0xEA, 0xEA, // 8000..8004
      0x20, 0x0A, 0x80, 0x60,       // 8005..8008 (sub1: JSR sub2; RTS)
      0xEA, 0x60,                   // 8009..800A (padding NOP at 8009, RTS at 800A)
    ];
    const { cpu } = cpuWithProgram(prog, 0x8000);
    cpu.step(); // JSR sub1
    expect(cpu.state.pc).toBe(0x8005);
    cpu.step(); // JSR sub2
    expect(cpu.state.pc).toBe(0x800A);
    cpu.step(); // RTS from sub2
    expect(cpu.state.pc).toBe(0x8008); // return to after JSR sub2
    cpu.step(); // RTS from sub1
    expect(cpu.state.pc).toBe(0x8003); // return to after JSR sub1
  });

  it('BRK pushes PC and P; RTI restores them using IRQ vector', () => {
    // Program executes BRK; IRQ/BRK vector points to $9000:
    // $9000: RTI
    const { cpu, bus } = cpuWithProgram([0x00], 0x8000); // BRK
    bus.write(0xFFFE, 0x00); bus.write(0xFFFF, 0x90);
    // Place RTI at $9000
    bus.write(0x9000, 0x40);
    const pcBefore = cpu.state.pc; // 0x8000
    cpu.step(); // BRK -> jump to 0x9000
    expect(cpu.state.pc).toBe(0x9000);
    // Now RTI should pull P and PC and resume after BRK (emulated as pc+1 due to our simplified BRK)
    cpu.step(); // RTI
    expect(cpu.state.pc).toBe((pcBefore + 1) & 0xFFFF);
  });

  it('IRQ service pushes PC/P and RTI returns (no re-IRQ after clear)', () => {
    // Program: SEI; CLI; NOP; then loop NOPs
    const { cpu, bus } = cpuWithProgram([0x78, 0x58, 0xEA, 0xEA, 0xEA], 0x8000);
    // IRQ vector to $9000 with RTI
    bus.write(0xFFFE, 0x00); bus.write(0xFFFF, 0x90);
    bus.write(0x9000, 0x40); // RTI

    cpu.step(); // SEI
    cpu.step(); // CLI (I=0)
    // Request IRQ; should be serviced before next instruction
    cpu.requestIRQ();
    cpu.step(); // service IRQ -> jump to $9000
    expect(cpu.state.pc).toBe(0x9000);
    // RTI returns to original stream at $8002 (next after CLI)
    cpu.step();
    expect(cpu.state.pc).toBe(0x8002);
  });
});

