import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NESSystem } from '@core/system/system';
import { parseINes } from '@core/cart/ines';

function getEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.length > 0 ? v : null;
}

function parseNestestLine(line: string) {
  // Example line prefix: "C000  A9 01  LDA #$01                        A:00 X:00 Y:00 P:24 SP:FD CYC:  7"
  // Extract key state fields
  const m = line.match(/^(?<pc>[0-9A-F]{4})\s+.*A:(?<A>[0-9A-F]{2}) X:(?<X>[0-9A-F]{2}) Y:(?<Y>[0-9A-F]{2}) P:(?<P>[0-9A-F]{2}) SP:(?<SP>[0-9A-F]{2}) CYC:\s*(?<CYC>\d+)/);
  if (!m || !m.groups) return null;
  return {
    pc: parseInt(m.groups.pc, 16) & 0xFFFF,
    A: parseInt(m.groups.A, 16) & 0xFF,
    X: parseInt(m.groups.X, 16) & 0xFF,
    Y: parseInt(m.groups.Y, 16) & 0xFF,
    P: parseInt(m.groups.P, 16) & 0xFF,
    SP: parseInt(m.groups.SP, 16) & 0xFF,
    CYC: parseInt(m.groups.CYC, 10) | 0,
  } as const;
}

describe.skipIf(!getEnv('NESTEST_ROM') || !getEnv('NESTEST_LOG'))('nestest CPU trace harness (optional)', () => {
  it('matches PC/A/X/Y/P/SP on a prefix of the log (smoke subset)', () => {
    const romPath = getEnv('NESTEST_ROM')!;
    const logPath = getEnv('NESTEST_LOG')!;
    const rom = parseINes(new Uint8Array(fs.readFileSync(path.resolve(romPath))));

    const sys = new NESSystem(rom);
    sys.reset();

    // Prepare: some nestest ROMs require starting at specific PC/state.
    // We assume the ROM's reset vector is correct; otherwise, users can provide a preamble.

    const lines = fs.readFileSync(path.resolve(logPath), 'utf-8').split(/\r?\n/).filter(Boolean);
    const limit = Math.min(lines.length, parseInt(process.env.NESTEST_MAX || '2000', 10));

    for (let i = 0; i < limit; i++) {
      const parsed = parseNestestLine(lines[i]);
      if (!parsed) continue; // skip unparseable

      // Compare pre-step PC to log PC
      expect(sys.cpu.state.pc & 0xFFFF).toBe(parsed.pc);

      // Step
      sys.stepInstruction();

      // After step, compare registers.
      // Note: B flag in P differs in how BRK/IRQ push sets it; mask it out for comparison (0x10).
      const Pmask = sys.cpu.state.p & 0xEF;
      const Pexpect = parsed.P & 0xEF;
      expect(sys.cpu.state.a & 0xFF).toBe(parsed.A);
      expect(sys.cpu.state.x & 0xFF).toBe(parsed.X);
      expect(sys.cpu.state.y & 0xFF).toBe(parsed.Y);
      expect(Pmask).toBe(Pexpect);
      expect(sys.cpu.state.s & 0xFF).toBe(parsed.SP);
    }
  });
});

