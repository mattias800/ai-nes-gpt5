import fs from 'node:fs';
import path from 'node:path';
import { parseINes } from '@core/cart/ines';
import { NESSystem } from '@core/system/system';

export interface BlarggRunOpts {
  readonly maxCycles?: number;
  readonly pollEveryInstr?: boolean; // if true, check status every instruction; else every pollStep instructions
  readonly pollStep?: number; // number of instructions between status polls when pollEveryInstr is false
  readonly requireMagic?: boolean; // verify $6001..$6003 = DE B0 61
  readonly resetDelayCycles?: number; // cycles to wait after 0x81 before reset (>= ~180k cycles)
}

export interface BlarggRunResult {
  readonly code: number; // 0 = pass, 1 = fail, >=2 = error/specific
  readonly message: string;
  readonly cycles: number;
}

const readU8 = (sys: NESSystem, a: number): number => sys.bus.read(a & 0xFFFF) & 0xFF;

const readCStr = (sys: NESSystem, base = 0x6004, max = 0x1FFC): string => {
  let s = '';
  for (let i = 0; i < max; i++) {
    const c = readU8(sys, (base + i) & 0xFFFF);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
};

const hasMagic = (sys: NESSystem): boolean => readU8(sys, 0x6001) === 0xDE && readU8(sys, 0x6002) === 0xB0 && readU8(sys, 0x6003) === 0x61;

export const runBlarggRom = (romPath: string, opts: BlarggRunOpts = {}): BlarggRunResult => {
  const {
    maxCycles = 60_000_000,
    pollEveryInstr = true,
    pollStep = 256,
    requireMagic = true,
    resetDelayCycles = 200_000,
  } = opts;

  const abs = path.resolve(romPath);
  const buf = new Uint8Array(fs.readFileSync(abs));
  const rom = parseINes(buf);
  const sys = new NESSystem(rom);
  // For deterministic CPU-only behavior; some tests can be disturbed by APU IRQs.
  if (typeof process !== 'undefined') process.env.DISABLE_APU_IRQ = process.env.DISABLE_APU_IRQ || '1';

  sys.reset();

  let nextResetAt: number | null = null;
  let instrCounter = 0;
  let lastMsg = '';

  const poll = (): { status: number; msg: string } => {
    if (requireMagic && !hasMagic(sys)) return { status: 0x80, msg: '' };
    const status = readU8(sys, 0x6000);
    const msg = readCStr(sys);
    if (msg.length > 0) lastMsg = msg;
    return { status, msg };
  };

  while (sys.cpu.state.cycles < maxCycles) {
    sys.stepInstruction();
    instrCounter++;

    // scheduled reset after delay
    if (nextResetAt !== null && sys.cpu.state.cycles >= nextResetAt) {
      sys.cpuResetOnly();
      nextResetAt = null;
      // after reset, continue loop; allow ROM to run
    }

    const shouldPoll = pollEveryInstr || (instrCounter % pollStep === 0);
    if (!shouldPoll) continue;

    const { status } = poll();

    if (status === 0x80) {
      // running
      continue;
    }
    if (status === 0x81) {
      if (nextResetAt === null) nextResetAt = sys.cpu.state.cycles + resetDelayCycles;
      continue;
    }
    if (status < 0x80) {
      return { code: status, message: lastMsg, cycles: sys.cpu.state.cycles };
    }
  }

  throw new Error(`Timeout: cycles=${sys.cpu.state.cycles} msg="${lastMsg}"`);
};
