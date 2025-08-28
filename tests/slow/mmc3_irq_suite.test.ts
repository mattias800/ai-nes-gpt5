/*
MMC3 IRQ test suite harness — integrates roms/nes-test-roms/mmc3_irq_tests
- Runs 1..4 as required PASS
- Runs 5 (rev A) and 6 (rev B); asserts at least one PASS to accommodate mapper revision differences
*/
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseINes } from '@core/cart/ines';
import { NESSystem } from '@core/system/system';

const STATUS_ADDR = 0x6000;
const SIG_ADDR = 0x6001; //..6003
const TEXT_ADDR = 0x6004;
const SIG0 = 0xde, SIG1 = 0xb0, SIG2 = 0x61;

interface A12TraceEntry { frame: number; scanline: number; cycle: number }
interface CtrlTraceEntry { frame: number; scanline: number; cycle: number; ctrl: number }
interface MaskTraceEntry { frame: number; scanline: number; cycle: number; mask: number }
interface MMC3TraceEntry {
  type: string; a?: number; v?: number; ctr?: number; en?: boolean; f?: number; s?: number; c?: number; ctrl?: number; op?: string; pre?: boolean;
}

interface RunOpts { timeoutCycles: number; resetDelayCycles: number }
interface RunResult {
  status: number; message: string; cycles: number; sigSeen: boolean;
  a12Trace: ReadonlyArray<A12TraceEntry>;
  ctrlTrace: ReadonlyArray<CtrlTraceEntry>;
  maskTrace: ReadonlyArray<MaskTraceEntry>;
  mmc3Trace: ReadonlyArray<MMC3TraceEntry> | null;
  lastStatus?: number; lastMsg?: string;
}

const hasSignature = (sys: NESSystem): boolean => {
  const b0 = sys.bus.read(SIG_ADDR);
  const b1 = sys.bus.read((SIG_ADDR + 1) & 0xffff);
  const b2 = sys.bus.read((SIG_ADDR + 2) & 0xffff);
  return b0 === SIG0 && b1 === SIG1 && b2 === SIG2;
};

const readText = (sys: NESSystem, addr: number = TEXT_ADDR, max: number = 512): string => {
  let s = '';
  for (let i = 0; i < max; i++) {
    const ch = sys.bus.read((addr + i) & 0xffff);
    if (ch === 0) break;
    s += String.fromCharCode(ch);
  }
  return s;
};

const runMmc3Rom = (romPath: string, opts: RunOpts): RunResult => {
  const buf = new Uint8Array(fs.readFileSync(romPath));
  const rom = parseINes(buf);
  // Disable APU IRQs to avoid interference with MMC3 tests
  process.env.DISABLE_APU_IRQ = '1';
  const sys = new NESSystem(rom);
  sys.reset();

  // Enable PRG-RAM for $6000.. protocol immediately
  sys.bus.write(0xA001, 0x80);

  const start = sys.cpu.state.cycles;
  const deadline = start + opts.timeoutCycles;

  let sigSeen = false;
  let scheduledResetAt: number | null = null;

  while (sys.cpu.state.cycles < deadline) {
    sys.stepInstruction();

    // Continuously probe signature; some ROMs request a timed reset (0x81) before setting the signature
    if (!sigSeen) sigSeen = hasSignature(sys);

    if (scheduledResetAt !== null && sys.cpu.state.cycles >= scheduledResetAt) {
      // ROM requests a reset press; perform CPU-only reset to match console semantics
      sys.cpuResetOnly();
      scheduledResetAt = null;
      continue;
    }

    // Read status opportunistically even if signature not yet seen to honor early reset requests
    const status = sys.bus.read(STATUS_ADDR);
    if (status === 0x80) {
      // running
      continue;
    } else if (status === 0x81) {
      // schedule a reset at least 100 ms later
      if (scheduledResetAt === null) {
        scheduledResetAt = sys.cpu.state.cycles + opts.resetDelayCycles;
      }
      continue;
    } else if (sigSeen) {
      const msg = readText(sys, TEXT_ADDR);
      const base: Omit<RunResult,'status'|'message'|'cycles'> = {
        sigSeen,
        a12Trace: sys.ppu.getA12Trace().slice(-32),
        ctrlTrace: sys.ppu.getCtrlTrace().slice(-64),
        maskTrace: sys.ppu.getMaskTrace().slice(-64),
        mmc3Trace: ((sys.cart as any).mapper && (typeof (sys.cart as any).mapper.getTrace === 'function')) ? (sys.cart as any).mapper.getTrace() as ReadonlyArray<MMC3TraceEntry> : null,
        lastStatus: status,
        lastMsg: msg,
      };
      return { status, message: msg, cycles: sys.cpu.state.cycles, ...base };
    } else {
      // Signature not yet confirmed; ignore other statuses and continue stepping
      continue;
    }
  }

  const lastStatus = sigSeen ? sys.bus.read(STATUS_ADDR) : -1;
  const lastMsg = sigSeen ? readText(sys, TEXT_ADDR) : '';
  return {
    status: 0x7F,
    message: `[timeout] ${path.basename(romPath)}`,
    cycles: sys.cpu.state.cycles,
    sigSeen,
    a12Trace: sys.ppu.getA12Trace().slice(-32),
    ctrlTrace: sys.ppu.getCtrlTrace().slice(-64),
    maskTrace: sys.ppu.getMaskTrace().slice(-64),
    mmc3Trace: ((sys.cart as any).mapper && (typeof (sys.cart as any).mapper.getTrace === 'function')) ? (sys.cart as any).mapper.getTrace() as ReadonlyArray<MMC3TraceEntry> : null,
    lastStatus,
    lastMsg,
  };
};

describe.skip('MMC3 IRQ test suite (skipped: ROMs do not use blargg $6000 protocol; covered by mapper unit tests)', () => {
  it('passes clocking/details/A12/scanline timing (1..4)', () => {
    const dir = path.resolve(process.env.MMC3_IRQ_DIR || 'roms/nes-test-roms/mmc3_irq_tests');
    const hz = Number.parseInt(process.env.MMC3_CPU_HZ || '1789773', 10);
    const timeoutCycles = Number.parseInt(process.env.MMC3_TIMEOUT_CYCLES || '250000000', 10);
    const resetDelayCycles = Math.floor(hz * 0.100);

    const required = [
      '1.Clocking.nes',
      '2.Details.nes',
      '3.A12_clocking.nes',
      '4.Scanline_timing.nes',
    ];

    expect(fs.existsSync(dir), `Missing MMC3_IRQ_DIR: ${dir}`).toBe(true);
    const missing = required.filter((f) => !fs.existsSync(path.join(dir, f)));
    expect(missing, `Missing ROMs: ${missing.join(', ')} (MMC3_IRQ_DIR=${dir})`).toEqual([]);

    for (const f of required) {
      const p = path.join(dir, f);
      const res = runMmc3Rom(p, { timeoutCycles, resetDelayCycles });
      if (res.status !== 0) {
        const a12 = res.a12Trace ?? [];
        const mmc3 = res.mmc3Trace ?? [];
        // eslint-disable-next-line no-console
        console.error(`[MMC3-IRQ DEBUG] ${f}: status=${res.status} msg=${JSON.stringify(res.message)} cycles=${res.cycles}`);
        // eslint-disable-next-line no-console
        console.error(`[MMC3-IRQ DEBUG] sigSeen=${res.sigSeen} lastStatus=${res.lastStatus} lastMsg=${JSON.stringify(res.lastMsg || '')}`);
        // eslint-disable-next-line no-console
        console.error(`[MMC3-IRQ DEBUG] A12 rises (last ${a12.length}): ${a12.map(t => `f${t.frame}s${t.scanline}c${t.cycle}`).join(', ')}`);
        const ctrl = res.ctrlTrace ?? [];
        if (ctrl && ctrl.length) {
          const tail = ctrl.slice(-64);
          // eslint-disable-next-line no-console
          console.error(`[MMC3-IRQ DEBUG] PPUCTRL writes (last ${tail.length}/${ctrl.length}): ${tail.map((e)=>`@[f${e.frame}s${e.scanline}c${e.cycle}] $2000=${(e.ctrl>>>0).toString(16).padStart(2,'0')}`).join(', ')}`);
        }
        const mask = res.maskTrace ?? [];
        if (mask && mask.length) {
          const tailm = mask.slice(-64);
          // eslint-disable-next-line no-console
          console.error(`[MMC3-IRQ DEBUG] PPUMASK writes (last ${tailm.length}/${mask.length}): ${tailm.map((e)=>`@[f${e.frame}s${e.scanline}c${e.cycle}] $2001=${(e.mask>>>0).toString(16).padStart(2,'0')}`).join(', ')}`);
        }
        if (mmc3 && (mmc3 as any).length) {
          const arr = mmc3 as ReadonlyArray<MMC3TraceEntry>;
          const counts = (arr as MMC3TraceEntry[]).reduce((m: Record<string, number>, e) => { m[e.type] = (m[e.type]||0)+1; return m; }, {} as Record<string, number>);
          // eslint-disable-next-line no-console
          console.error(`[MMC3-IRQ DEBUG] MMC3 trace counts: ${Object.entries(counts).map(([k,v])=>`${k}:${v}`).join(', ')}`);
        }
      }
      expect(res.status, `ROM ${f} reported message: ${res.message}`).toBe(0);
    }
  });

  it('passes at least one of MMC3 rev A/B (5 or 6)', () => {
    const dir = path.resolve(process.env.MMC3_IRQ_DIR || 'roms/nes-test-roms/mmc3_irq_tests');
    const hz = Number.parseInt(process.env.MMC3_CPU_HZ || '1789773', 10);
    const timeoutCycles = Number.parseInt(process.env.MMC3_TIMEOUT_CYCLES || '250000000', 10);
    const resetDelayCycles = Math.floor(hz * 0.100);

    const variants = ['5.MMC3_rev_A.nes', '6.MMC3_rev_B.nes'];
    const missing = variants.filter((f) => !fs.existsSync(path.join(dir, f)));
    expect(missing, `Missing ROMs: ${missing.join(', ')} (MMC3_IRQ_DIR=${dir})`).toEqual([]);

    const results = variants.map((f) => ({ f, res: runMmc3Rom(path.join(dir, f), { timeoutCycles, resetDelayCycles }) }));

    const pass = results.filter(r => r.res.status === 0);
    if (pass.length === 0) {
      // Print combined diagnostics
      for (const { f, res } of results) {
        // eslint-disable-next-line no-console
        console.error(`[MMC3-IRQ DEBUG] ${f}: status=${res.status} msg=${JSON.stringify(res.message)} cycles=${res.cycles}`);
      }
    }
    expect(pass.length > 0, `Neither revision passed. A: status=${results[0].res.status} msg=${results[0].res.message}; B: status=${results[1].res.status} msg=${results[1].res.message}`).toBe(true);
  });
});

