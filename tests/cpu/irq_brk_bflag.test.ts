import { describe, it, expect } from 'vitest';
import { cpuWithProgram } from '../helpers/cpuh';

// Verify P flag pushed on stack differs for BRK (B=1) vs IRQ (B=0)

describe('CPU BRK vs IRQ pushes P with correct B flag', () => {
  it('BRK pushes P with B=1; IRQ pushes P with B=0', () => {
    // Program: at $8000: NOP; BRK
    const { cpu, bus } = cpuWithProgram([0xEA, 0x00], 0x8000);
    // IRQ/BRK vector to $9000; NMI unused
    bus.write(0xFFFE, 0x00); bus.write(0xFFFF, 0x90);
    // Place RTI at $9000 to return
    bus.write(0x9000, 0x40);

    // Step NOP
    cpu.step();
    // Execute BRK: should push PC and P with B=1, jump to $9000
    cpu.step();
    expect(cpu.state.pc).toBe(0x9000);
    // Stack after BRK: [S] now at 0xFA; pushed P at 0x1FB, PCL at 0x1FC, PCH at 0x1FD
    const pPushedBrk = bus.read(0x01FB);
    expect((pPushedBrk & 0x10) !== 0).toBe(true); // B set
    // Check what address was pushed (BRK pushes PC+1 where PC after fetching opcode is $8002)
    const pushedPCL = bus.read(0x01FC);
    const pushedPCH = bus.read(0x01FD);
    const pushedPC = pushedPCL | (pushedPCH << 8);

    // RTI back
    cpu.step();
    // After RTI, PC should be at the address BRK pushed ($8003)
    expect(cpu.state.pc).toBe(pushedPC);
    expect(cpu.state.pc).toBe(0x8003);
    
    // Now trigger a maskable IRQ: need to clear I first!
    // Place CLI at current PC (which is $8003 after RTI from BRK)
    bus.write(cpu.state.pc, 0x58); // CLI
    cpu.step(); // step CLI
    expect(cpu.state.pc).toBe(0x8004);
    
    // Verify I flag is now clear
    expect((cpu.state.p & 0x04) === 0).toBe(true); // I should be clear
    
    // Request IRQ and execute next instruction fetch -> should service
    const sBeforeIrq = cpu.state.s;
    cpu.requestIRQ();
    cpu.step();
    expect(cpu.state.pc).toBe(0x9000);
    const pPushedIrq = bus.read(0x0100 + ((sBeforeIrq) & 0xFF) - 0x02); // pushed P ends up at S-2 (after two PC bytes)
    // Alternatively, read known location 0x01FB is fragile; compute from sBeforeIrq: pushes at [S]->hi, [S-1]->lo, [S-2]->P
    expect((pPushedIrq & 0x10) !== 0).toBe(false); // B clear
  });
});

