import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  // Place a simple program at $8000 that does: CLI; NOP; JMP $8001 (loop NOPs with I clear)
  prg[0x0000] = 0x58; // CLI
  prg[0x0001] = 0xEA; // NOP
  prg[0x0002] = 0x4C; prg[0x0003] = 0x01; prg[0x0004] = 0x80; // JMP $8001
  // Reset vector to $8000
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  // IRQ/BRK vector to $9000 (we'll leave PRG there as 0x00 which is BRK, but vector load is what we assert on)
  prg[0x7FFE] = 0x00; prg[0x7FFF] = 0x90;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU DMC -> CPU IRQ integration', () => {
  it('asserts CPU IRQ when DMC sample completes with IRQ enabled', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Configure DMC: IRQ enabled, non-loop, small sample, fastest rate
    sys.io.write(0x4010, 0x80 | 0x0F); // IRQ on, loop=0, rate idx=15 (fast)
    sys.io.write(0x4012, 0x01);        // address base
    sys.io.write(0x4013, 0x02);        // length base = 33 bytes

    // Inhibit frame IRQs so the first IRQ we observe is from DMC
    sys.io.write(0x4017, 0x40);

    // Enable DMC
    sys.io.write(0x4015, 0x10);

    // Step instructions until we observe the CPU vector to $9000, or bail out
    let vectored = false;
    for (let i = 0; i < 20000; i++) {
      sys.stepInstruction();
      if (sys.cpu.state.pc === 0x9000) { vectored = true; break; }
    }
    expect(vectored).toBe(true);

    // DMC IRQ flag should be set; reading $4015 returns bit7 set then clears it
    const st1 = sys.io.read(0x4015);
    expect((st1 & 0x80) !== 0).toBe(true);
    const st2 = sys.io.read(0x4015);
    expect((st2 & 0x80) !== 0).toBe(false);
  });
});

