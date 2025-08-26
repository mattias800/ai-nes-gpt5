import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

// Verify that when both NMI and IRQ are pending, NMI is serviced first and IRQ remains pending until later.

describe('CPU interrupt priority: NMI over IRQ', () => {
  it('services NMI before IRQ when both are pending', () => {
    const { cpu, bus } = cpuWithProgram([0xEA], 0x8000); // NOP
    // Set NMI vector to $9000, IRQ vector to $A000
    bus.write(0xFFFA, 0x00); bus.write(0xFFFB, 0x90);
    bus.write(0xFFFE, 0x00); bus.write(0xFFFF, 0xA0);

    // Request both interrupts before stepping
    cpu.requestIRQ();
    cpu.requestNMI();

    cpu.step();
    expect(cpu.state.pc).toBe(0x9000); // NMI serviced

    // Now, after returning, ensure IRQ can still be serviced. Place RTI at $9000.
    bus.write(0x9000, 0x40); // RTI
    cpu.step(); // RTI (restores PC to 0x8000)
    // Ensure CLI at current PC (0x8000) to clear I
    bus.write(0x8000, 0x58); // CLI
    cpu.step(); // execute CLI at 0x8000
    // Next step should service pending IRQ
    cpu.step();
    expect(cpu.state.pc).toBe(0xA000);
  });
});
