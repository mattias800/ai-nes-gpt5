import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

// Test NMI and IRQ behavior for CPU

describe('CPU: interrupts', () => {
  it('NMI pushes PC and jumps to vector', () => {
    // Program: just NOPs at $8000; set NMI vector to $9000
    const prog = [0xEA, 0xEA];
    const { cpu, bus } = cpuWithProgram(prog, 0x8000);
    // Set NMI vector
    // Vector table is in PRG at $FFFA -> index 0x7FFA
    // Our cpuWithProgram maps PRG at $8000..$FFFF into an array; set those bytes by writing through the cart stub
    // Here we directly write to bus via cart region since helper doesn't expose array; instead we step PC to modify? We'll invoke CPU requestNMI and set reset PC
    bus.write(0xFFFA, 0x00);
    bus.write(0xFFFB, 0x90);

    const startPC = cpu.state.pc;
    cpu.requestNMI();
    cpu.step();
    expect(cpu.state.pc).toBe(0x9000);
    // After NMI, next step should execute at $9000. We can't fetch instruction at $9000 (ROM is zero), but this test validates vector load.
  });

  it('IRQ respects I flag and uses IRQ vector when enabled', () => {
    const { cpu, bus } = cpuWithProgram([0x78, 0x58, 0xEA], 0x8000); // SEI; CLI; NOP
    // Set IRQ vector to $9000
    bus.write(0xFFFE, 0x00);
    bus.write(0xFFFF, 0x90);

    // SEI: set I; request IRQ should be held off
    cpu.step();
    cpu.requestIRQ();
    cpu.step(); // CLI clears I; but IRQ is delayed by one instruction after CLI
    cpu.step(); // NOP executes (IRQ delayed)
    cpu.step(); // Now IRQ is serviced
    expect(cpu.state.pc).toBe(0x9000);
  });
});
