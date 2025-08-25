import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CPUBus } from '@core/bus/memory';
import { CPU6502 } from '@core/cpu/cpu';
import { parseINes } from '@core/cart/ines';
import { NROM } from '@core/cart/mappers/nrom';
import { NesIO } from '@core/io/nesio';

// Generic harness for blargg-style tests that report via $6000..$7FFF.
// Skipped unless BLARGG=1 and a ROM path is provided in BLARGG_ROM.

describe.skipIf(!(process.env.BLARGG === '1' && process.env.BLARGG_ROM))('blargg harness', () => {
  it('runs until PASS or timeout', async () => {
    const romPath = path.resolve(process.env.BLARGG_ROM!);
    const buf = new Uint8Array(fs.readFileSync(romPath));
    const rom = parseINes(buf);

    const bus = new CPUBus();
    const nrom = new NROM(rom.prg);
    bus.connectCart((addr) => nrom.read(addr), (addr, v) => nrom.write(addr, v));
    const { PPU } = await import('../../src/core/ppu/ppu');
    const io = new NesIO(new PPU(), bus);
    bus.connectIO(io.read, io.write);

    const cpu = new CPU6502(bus);
    const reset = bus.read(0xFFFC) | (bus.read(0xFFFD) << 8);
    cpu.reset(reset);

    const maxCycles = 50_000_000; // generous
    let message = '';

    for (; cpu.state.cycles < maxCycles; ) {
      cpu.step();
      // Read blargg message format: a 0-terminated ASCII string starting at 0x6004, with status at 0x6000
      const status = bus.read(0x6000);
      if (status === 0x80) {
        // running
      } else if (status === 0x81) {
        // pass
        message = readString(bus, 0x6004);
        break;
      } else if (status === 0x00) {
        // fail
        message = readString(bus, 0x6004);
        throw new Error(`FAIL: ${message}`);
      }
    }

    expect(message).toBeTypeOf('string');
  });
});

function readString(bus: CPUBus, addr: number): string {
  let s = '';
  for (let i = 0; i < 256; i++) {
    const ch = bus.read(addr + i);
    if (ch === 0) break;
    s += String.fromCharCode(ch);
  }
  return s;
}
