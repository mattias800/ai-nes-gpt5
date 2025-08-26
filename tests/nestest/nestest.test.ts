import { describe, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CPUBus } from '@core/bus/memory';
import { CPU6502 } from '@core/cpu/cpu';
import { parseINes } from '@core/cart/ines';
import { NROM } from '@core/cart/mappers/nrom';

// This is a skeleton; it is skipped by default. Enable by setting NESTEST=1 and
// placing nestest.nes and nestest.log in ./roms

const ROM_DIR = path.resolve('roms');
const NES_PATH = path.join(ROM_DIR, 'nestest.nes');
const LOG_PATH = path.join(ROM_DIR, 'nestest.log');

const enabled = process.env.NESTEST === '1' && fs.existsSync(NES_PATH) && fs.existsSync(LOG_PATH);

describe.skipIf(!enabled)('nestest', () => {
  it('steps through and matches CPU state (PC,A,X,Y,P,SP)', () => {
    const romBuf = new Uint8Array(fs.readFileSync(NES_PATH));
    const rom = parseINes(romBuf);
    const bus = new CPUBus();
    const nrom = new NROM(rom.prg, rom.chr);
    bus.connectCart((addr) => nrom.cpuRead(addr), (addr, v) => nrom.cpuWrite(addr, v));
    bus.connectIO((_addr) => 0x00, (_addr, _v) => {});

    const cpu = new CPU6502(bus);
    // nestest commonly uses start at $C000
    cpu.reset(0xC000);

    const lines = fs.readFileSync(LOG_PATH, 'utf-8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      // Example line: C000  A9 00     LDA #$00                        A:00 X:00 Y:00 P:24 SP:FD PPU: ...
      const m = /^(?<pc>[0-9A-F]{4}).*A:(?<a>[0-9A-F]{2}) X:(?<x>[0-9A-F]{2}) Y:(?<y>[0-9A-F]{2}) P:(?<p>[0-9A-F]{2}) SP:(?<s>[0-9A-F]{2})/.exec(line);
      if (!m || !m.groups) continue;
      const expectPC = parseInt(m.groups.pc, 16);
      const expectA = parseInt(m.groups.a, 16);
      const expectX = parseInt(m.groups.x, 16);
      const expectY = parseInt(m.groups.y, 16);
      const expectP = parseInt(m.groups.p, 16);
      const expectS = parseInt(m.groups.s, 16);

      if (cpu.state.pc !== expectPC) {
        throw new Error(`PC mismatch before step: got ${cpu.state.pc.toString(16)}, expected ${expectPC.toString(16)}`);
      }
      // Compare CPU state BEFORE executing this instruction; nestest.log reports pre-step state
      const maskB = 0xEF; // ignore B flag differences
      if (cpu.state.a !== expectA || cpu.state.x !== expectX || cpu.state.y !== expectY || (cpu.state.p & maskB) !== (expectP & maskB) || cpu.state.s !== expectS) {
        throw new Error(`State mismatch before step at PC=${expectPC.toString(16)}\n`+
          `A=${hex(cpu.state.a)} X=${hex(cpu.state.x)} Y=${hex(cpu.state.y)} P=${hex(cpu.state.p)} S=${hex(cpu.state.s)}\n`+
          `expected A=${hex(expectA)} X=${hex(expectX)} Y=${hex(expectY)} P=${hex(expectP)} S=${hex(expectS)}`);
      }
      try {
        cpu.step();
      } catch (e) {
        // If an opcode is not implemented yet, make the failure clear
        throw e;
      }
    }
  });
});

function hex(n: number, w = 2) { return n.toString(16).toUpperCase().padStart(w, '0'); }
