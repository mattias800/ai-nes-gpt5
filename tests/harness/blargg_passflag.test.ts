import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseINes } from '@core/cart/ines';
import { NESSystem } from '@core/system/system';

// Generic harness for blargg-style tests that report via $6000..$7FFF.
// Skipped unless BLARGG=1 and a ROM path is provided in BLARGG_ROM.

describe.skipIf(!(process.env.BLARGG === '1' && process.env.BLARGG_ROM))('blargg harness', () => {
  it('runs until PASS or timeout', async () => {
    const romPath = path.resolve(process.env.BLARGG_ROM!);
    const buf = new Uint8Array(fs.readFileSync(romPath));
    const rom = parseINes(buf);

    const sys = new NESSystem(rom);
    sys.reset();

    const maxCycles = Number.parseInt(process.env.BLARGG_TIMEOUT || '50000000', 10);
    let message = '';

    while (sys.cpu.state.cycles < maxCycles) {
      sys.stepInstruction();
      // Read blargg message format: a 0-terminated ASCII string starting at 0x6004, with status at 0x6000
      const status = sys.bus.read(0x6000);
      if (status === 0x80) {
        // running
      } else if (status === 0x81) {
        // pass
        message = readString(sys, 0x6004);
        break;
      } else if (status === 0x00) {
        // fail
        message = readString(sys, 0x6004);
        throw new Error(`FAIL: ${message}`);
      }
    }

    expect(message).toBeTypeOf('string');
  });
});

function readString(sys: NESSystem, addr: number): string {
  let s = '';
  for (let i = 0; i < 256; i++) {
    const ch = sys.bus.read((addr + i) & 0xFFFF);
    if (ch === 0) break;
    s += String.fromCharCode(ch);
  }
  return s;
}
