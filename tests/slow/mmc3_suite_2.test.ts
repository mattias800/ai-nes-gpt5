/*
MMC3 Test 2 (rom_singles) harness — integrates roms/nes-test-roms/mmc3_test_2/rom_singles
- Uses the standard blargg-style $6000 text/status protocol
- Mirrors tests/slow/mmc3_suite.test.ts behavior, but targets the mmc3_test_2 set
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

    if (!sigSeen) sigSeen = hasSignature(sys);

    if (scheduledResetAt !== null && sys.cpu.state.cycles >= scheduledResetAt) {
      // Use CPU-only reset to match console RESET behavior
      sys.cpuResetOnly();
      scheduledResetAt = null;
      continue;
    }

    if (!sigSeen) continue; // don't read status until signature is present

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
    } else {
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

describe('MMC3 test 2 suite (rom_singles)', () => {
  it('passes all sub-tests in order', () => {
    const dir = path.resolve(process.env.MMC3_2_DIR || 'roms/nes-test-roms/mmc3_test_2/rom_singles');
    const hz = Number.parseInt(process.env.MMC3_CPU_HZ || '1789773', 10);
    const timeoutCycles = Number.parseInt(process.env.MMC3_TIMEOUT_CYCLES || '250000000', 10);
    const resetDelayCycles = Math.floor(hz * 0.100);

    const files = [
      '1-clocking.nes',
      '2-details.nes',
      '3-A12_clocking.nes',
      '4-scanline_timing.nes',
      '5-MMC3.nes',
      '6-MMC3_alt.nes',
    ];

    expect(fs.existsSync(dir), `Missing MMC3_2_DIR: ${dir}`).toBe(true);
    const missing = files.filter((f) => !fs.existsSync(path.join(dir, f)));
    expect(missing, `Missing ROMs: ${missing.join(', ')} (MMC3_2_DIR=${dir})`).toEqual([]);

    for (const f of files) {
      const p = path.join(dir, f);
      const res = runMmc3Rom(p, { timeoutCycles, resetDelayCycles });
      if (res.status !== 0) {
        const a12 = res.a12Trace ?? [];
        const mmc3 = res.mmc3Trace ?? [];
        // eslint-disable-next-line no-console
        console.error(`[MMC3-2 DEBUG] ${f}: status=${res.status} msg=${JSON.stringify(res.message)} cycles=${res.cycles}`);
        // eslint-disable-next-line no-console
        console.error(`[MMC3-2 DEBUG] sigSeen=${res.sigSeen} lastStatus=${res.lastStatus} lastMsg=${JSON.stringify(res.lastMsg || '')}`);
        // eslint-disable-next-line no-console
        console.error(`[MMC3-2 DEBUG] A12 rises (last ${a12.length}): ${a12.map(t => `f${t.frame}s${t.scanline}c${t.cycle}`).join(', ')}`);
        const ctrl = res.ctrlTrace ?? [];
        if (ctrl && ctrl.length) {
          const tail = ctrl.slice(-64);
          // eslint-disable-next-line no-console
          console.error(`[MMC3-2 DEBUG] PPUCTRL writes (last ${tail.length}/${ctrl.length}): ${tail.map((e)=>`@[f${e.frame}s${e.scanline}c${e.cycle}] $2000=${(e.ctrl>>>0).toString(16).padStart(2,'0')}`).join(', ')}`);
        }
        const mask = res.maskTrace ?? [];
        if (mask && mask.length) {
          const tailm = mask.slice(-64);
          // eslint-disable-next-line no-console
          console.error(`[MMC3-2 DEBUG] PPUMASK writes (last ${tailm.length}/${mask.length}): ${tailm.map((e)=>`@[f${e.frame}s${e.scanline}c${e.cycle}] $2001=${(e.mask>>>0).toString(16).padStart(2,'0')}`).join(', ')}`);
        }
        if (mmc3 && (mmc3 as any).length) {
          const arr = mmc3 as ReadonlyArray<MMC3TraceEntry>;
          const counts = (arr as MMC3TraceEntry[]).reduce((m: Record<string, number>, e) => { m[e.type] = (m[e.type]||0)+1; return m; }, {} as Record<string, number>);
          // eslint-disable-next-line no-console
          console.error(`[MMC3-2 DEBUG] MMC3 trace counts: ${Object.entries(counts).map(([k,v])=>`${k}:${v}`).join(', ')}`);
          const a12s = (arr as MMC3TraceEntry[]).filter(e=>e.type==='A12');
          const tail = a12s.slice(-48);
          // eslint-disable-next-line no-console
          console.error(`[MMC3-2 DEBUG] A12 tail (${tail.length}): ${tail.map(e=>`op=${(e as any).op||'?'} ctr=${e.ctr}${e.en!==undefined?` en=${e.en}`:''}${(e as any).f!==undefined?` @[f${(e as any).f}s${(e as any).s}c${(e as any).c}]`:''}`).join(' | ')}`);
          const firstDecToZero = a12s.findIndex((e)=> (e as any).op==='dec' && (e.ctr===0));
          if (firstDecToZero >= 0) {
            const s = Math.max(0, firstDecToZero - 6), e = Math.min(a12s.length, firstDecToZero + 7);
            const win = a12s.slice(s, e);
            // eslint-disable-next-line no-console
            console.error(`[MMC3-2 DEBUG] around first dec->0 @${firstDecToZero}: ${win.map(e=>`op=${(e as any).op} ctr=${e.ctr}${e.en!==undefined?` en=${e.en}`:''}${(e as any).f!==undefined?` @[f${(e as any).f}s${(e as any).s}c${(e as any).c}]`:''}`).join(' | ')}`);
          }
          const irqIdx = (arr as MMC3TraceEntry[]).findIndex(e=>e.type==='IRQ');
          if (irqIdx >= 0) {
            const ws = Math.max(0, irqIdx - 8), we = Math.min(arr.length, irqIdx + 9);
            const w = (arr as MMC3TraceEntry[]).slice(ws, we);
            // eslint-disable-next-line no-console
            console.error(`[MMC3-2 DEBUG] around first IRQ @${irqIdx}: ${w.map(e=> e.type + (e.ctr!==undefined?`(ctr=${e.ctr}${e.en!==undefined?`,en=${e.en}`:''})`:'' ) + (e.v!==undefined?` v=${e.v}`:'' ) + (e.a!==undefined?` a=${e.a}`:'' ) + ((e as any).f!==undefined?` @[f${(e as any).f}s${(e as any).s}c${(e as any).c}]`:'' )).join(' | ')}`);
          }
        }
      }
      expect(res.status, `ROM ${f} reported message: ${res.message}`).toBe(0);
    }
  });
});

