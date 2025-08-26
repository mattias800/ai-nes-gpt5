import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  // Reset vector -> $8000, IRQ/BRK vector -> $9000
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  prg[0x7FFE] = 0x00; prg[0x7FFF] = 0x90;
  // Program at $8000:
  //   SEI
  // loop: LDA $00; BNE cli; JMP loop; cli: CLI; JMP cli (wait)
  prg[0x0000] = 0x78;             // SEI
  prg[0x0001] = 0xA5; prg[0x0002] = 0x00; // LDA $00
  prg[0x0003] = 0xD0; prg[0x0004] = 0x03; // BNE +3 -> to $8008
  prg[0x0005] = 0x4C; prg[0x0006] = 0x01; prg[0x0007] = 0x80; // JMP $8001 (loop)
  prg[0x0008] = 0x58;             // CLI
  prg[0x0009] = 0x4C; prg[0x000A] = 0x09; prg[0x000B] = 0x80; // JMP $8009 (hold)
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU DMC IRQ gating by CPU I flag', () => {
  it('does not service DMC IRQ while I=1; services after CLI', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Configure DMC to trigger IRQ quickly: enable IRQ, short length, enable channel
    // Set DMC sample to some CPU address; we can point it to zero page where reads are defined
    sys.io.write(0x4010, 0x8F); // IRQ enabled (bit7), rate index=15 (fastest), loop off
    sys.io.write(0x4012, 0x00); // sample address $C000
    sys.io.write(0x4013, 0x01); // length = 1*16 + 1 = 17 bytes
    sys.io.write(0x4015, 0x10); // enable DMC

    // Step a while with I=1 (SEI executed) and allow APU to tick; IRQ should not be taken
    let serviced = false;
    for (let i = 0; i < 20000; i++) {
      const before = sys.cpu.state.pc;
      sys.stepInstruction();
      if (sys.cpu.state.pc === 0x9000) { serviced = true; break; }
    }
    expect(serviced).toBe(false);

    // Clear I flag by setting $00!=0 so branch to CLI is taken
    (sys as any).bus.write(0x0000, 0x01);
    // Run a little to execute CLI
    let cliExecuted = false;
    for (let i = 0; i < 2000; i++) {
      sys.stepInstruction();
      if ((sys.cpu.state.p & 0x04) === 0) { cliExecuted = true; break; }
    }
    expect(cliExecuted).toBe(true);

    // Now run until IRQ is serviced
    let serviced2 = false;
    for (let i = 0; i < 20000; i++) {
      sys.stepInstruction();
      if (sys.cpu.state.pc === 0x9000) { serviced2 = true; break; }
    }
    expect(serviced2).toBe(true);
  });
});

