import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  // Program: CLI; NOP; JMP $8001 to keep I clear and loop
  prg[0x0000] = 0x58; // CLI
  prg[0x0001] = 0xEA; // NOP
  prg[0x0002] = 0x4C; prg[0x0003] = 0x01; prg[0x0004] = 0x80; // JMP $8001
  // Reset vector to $8000
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  // IRQ vector to $9000
  prg[0x7FFE] = 0x00; prg[0x7FFF] = 0x90;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU frame IRQ -> CPU IRQ integration', () => {
  it('vectors to IRQ when frame IRQ asserts in 4-step mode (not inhibited)', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // 4-step mode with IRQs enabled (bit6=0, bit7=0)
    sys.io.write(0x4017, 0x00);

    // Run enough instructions for at least one frame counter sequence end (~14916 CPU cycles)
    let vectored = false;
    for (let i = 0; i < 20000; i++) {
      sys.stepInstruction();
      if (sys.cpu.state.pc === 0x9000) { vectored = true; break; }
    }
    expect(vectored).toBe(true);

    // $4015 should report bit6 set once; reading clears it
    const st1 = sys.io.read(0x4015);
    expect((st1 & 0x40) !== 0).toBe(true);
    const st2 = sys.io.read(0x4015);
    expect((st2 & 0x40) !== 0).toBe(false);
  });

  it('does not vector when IRQs are inhibited (5-step mode)', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // 5-step mode: bit7=1 sets mode 5 and inhibits IRQ
    sys.io.write(0x4017, 0x80);

    let vectored = false;
    for (let i = 0; i < 25000; i++) {
      sys.stepInstruction();
      if (sys.cpu.state.pc === 0x9000) { vectored = true; break; }
    }
    expect(vectored).toBe(false);

    // $4015 bit6 should not be set (reading shows 0)
    const st = sys.io.read(0x4015);
    expect((st & 0x40) !== 0).toBe(false);
  });
});

