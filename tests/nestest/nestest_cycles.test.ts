import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CPUBus } from '@core/bus/memory';
import { CPU6502 } from '@core/cpu/cpu';
import { parseINes } from '@core/cart/ines';
import { NROM } from '@core/cart/mappers/nrom';

const ROM_DIR = path.resolve('roms');
const NES_PATH = path.join(ROM_DIR, 'nestest.nes');
const LOG_PATH = path.join(ROM_DIR, 'nestest.log');

const enabled = process.env.NESTEST === '1' && fs.existsSync(NES_PATH) && fs.existsSync(LOG_PATH);

describe.skipIf(!enabled)('nestest cycles', () => {
  it('matches per-instruction CPU cycle deltas from log', () => {
    const romBuf = new Uint8Array(fs.readFileSync(NES_PATH));
    const rom = parseINes(romBuf);
    const bus = new CPUBus();
    const nrom = new NROM(rom.prg, rom.chr);
    bus.connectCart((addr) => nrom.cpuRead(addr), (addr, v) => nrom.cpuWrite(addr, v));
    bus.connectIO((_addr) => 0x00, (_addr, _v) => {});

    const cpu = new CPU6502(bus);
    cpu.reset(0xC000);

    const lines = fs.readFileSync(LOG_PATH, 'utf-8').split(/\r?\n/).filter(Boolean);
    // Pre-parse cycles and PCs
    const entries = lines.map((line) => {
      const m = /^(?<pc>[0-9A-F]{4}).*CYC:(?<cyc>\d+)/.exec(line);
      if (!m || !m.groups) return null as any;
      return { pc: parseInt(m.groups.pc, 16), cyc: parseInt(m.groups.cyc, 10) };
    }).filter(Boolean) as { pc: number, cyc: number }[];

    for (let i = 0; i < entries.length - 1; i++) {
      const cur = entries[i];
      const next = entries[i + 1];
      // Ensure we're aligned at the right PC before stepping
      expect(cpu.state.pc).toBe(cur.pc);
      const before = cpu.state.cycles;
      cpu.step();
      const delta = cpu.state.cycles - before;
      const expectDelta = next.cyc - cur.cyc;
      expect(delta).toBe(expectDelta);
    }
  });
});

