/*
 MMC3/6 blargg-style test harness
 - Protocol (from mmc3_test/readme.txt and source/common/text_out.s):
   - $6001..$6003 signature: 0xDE 0xB0 0x61 indicates valid text/status region
   - $6000 status byte:
       0x80: running
       0x81: requires pressing reset, but only after at least 100 ms from now
       0x00..0x7F: final code (0 = pass, 1 = fail, >=2 = specific error)
   - $6004..: zero-terminated ASCII text (diagnostics)
 - Environment variables:
   - MMC3_DIR: directory with ROMs (default: roms/nes-test-roms/mmc3_test)
   - MMC3_TIMEOUT_CYCLES: per-ROM timeout in CPU cycles (default: 250000000)
   - MMC3_CPU_HZ: CPU frequency for reset delay calc (default: 1789773 NTSC)
   - MMC3_INCLUDE_MMC6: include 6-MMC6.nes (default: "1"); set "0" to skip
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

interface RunOpts {
  timeoutCycles: number;
  resetDelayCycles: number;
  wallTimeoutMs?: number;
}

interface RunResult { status: number; message: string; cycles: number; debug?: { a12Trace: Array<{ frame: number; scanline: number; cycle: number }>; ctrlTrace: Array<{ frame: number; scanline: number; cycle: number; ctrl: number }>; maskTrace: Array<{ frame: number; scanline: number; cycle: number; mask: number }>; mmc3Trace: ReadonlyArray<{ type: string, a?: number, v?: number, ctr?: number, en?: boolean, f?: number, s?: number, c?: number }> | null; lastStatus: number; lastMsg: string; sigSeen: boolean; } }

function hasSignature(sys: NESSystem): boolean {
  const b0 = sys.bus.read(SIG_ADDR);
  const b1 = sys.bus.read((SIG_ADDR + 1) & 0xffff);
  const b2 = sys.bus.read((SIG_ADDR + 2) & 0xffff);
  return b0 === SIG0 && b1 === SIG1 && b2 === SIG2;
}

function readText(sys: NESSystem, addr = TEXT_ADDR, max = 512): string {
  let s = '';
  for (let i = 0; i < max; i++) {
    const ch = sys.bus.read((addr + i) & 0xffff);
    if (ch === 0) break;
    s += String.fromCharCode(ch);
  }
  return s;
}

function runMmc3Rom(romPath: string, opts: RunOpts): RunResult {
  const buf = new Uint8Array(fs.readFileSync(romPath));
  const rom = parseINes(buf);
  // Disable APU IRQs to avoid interference with MMC3 tests
  (process as any).env.DISABLE_APU_IRQ = '1';
  const sys = new NESSystem(rom);
  sys.reset();

  // Ensure PRG-RAM is enabled and writeable for blargg-style $6000 protocol
  // Many MMC3 carts power up with WRAM enabled; tests expect immediate writes to $6000..
  sys.bus.write(0xA001, 0x80);

  const start = sys.cpu.state.cycles;
  const deadline = start + opts.timeoutCycles;
  const wallDeadline = Date.now() + (opts.wallTimeoutMs ?? Number.parseInt(process.env.MMC3_WALL_TIMEOUT_MS || '300000', 10));

  let sigSeen = false;
  let scheduledResetAt: number | null = null;

  while (sys.cpu.state.cycles < deadline) {
    sys.stepInstruction();
    if (Date.now() >= wallDeadline) break;

    if (!sigSeen) sigSeen = hasSignature(sys);

    if (scheduledResetAt !== null && sys.cpu.state.cycles >= scheduledResetAt) {
      sys.reset();
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
      if (status === 0x00) {
        return { status, message: msg, cycles: sys.cpu.state.cycles, debug: {
          a12Trace: sys.ppu.getA12Trace().slice(-32),
          ctrlTrace: (sys.ppu as any).getCtrlTrace?.() ?? [],
          maskTrace: (sys.ppu as any).getMaskTrace?.() ?? [],
          mmc3Trace: ((sys.cart as any).mapper && (typeof (sys.cart as any).mapper.getTrace === 'function')) ? (sys.cart as any).mapper.getTrace() : null,
          lastStatus: status,
          lastMsg: msg,
          sigSeen: sigSeen,
        } };
      }
      return { status, message: msg, cycles: sys.cpu.state.cycles, debug: {
        a12Trace: sys.ppu.getA12Trace().slice(-32),
        ctrlTrace: (sys.ppu as any).getCtrlTrace?.() ?? [],
        maskTrace: (sys.ppu as any).getMaskTrace?.() ?? [],
        mmc3Trace: ((sys.cart as any).mapper && (typeof (sys.cart as any).mapper.getTrace === 'function')) ? (sys.cart as any).mapper.getTrace() : null,
        lastStatus: status,
        lastMsg: msg,
        sigSeen: sigSeen,
      } };
    }
  }

  const lastStatus = sigSeen ? sys.bus.read(STATUS_ADDR) : -1;
  const lastMsg = sigSeen ? readText(sys, TEXT_ADDR) : '';
  return { status: 0x7F, message: `[timeout] ${path.basename(romPath)}`, cycles: sys.cpu.state.cycles, debug: {
    a12Trace: sys.ppu.getA12Trace().slice(-32),
    ctrlTrace: (sys.ppu as any).getCtrlTrace?.() ?? [],
    maskTrace: (sys.ppu as any).getMaskTrace?.() ?? [],
    mmc3Trace: ((sys.cart as any).mapper && (typeof (sys.cart as any).mapper.getTrace === 'function')) ? (sys.cart as any).mapper.getTrace() : null,
    lastStatus: lastStatus,
    lastMsg: lastMsg,
    sigSeen: sigSeen,
  } };
}

describe('MMC3 test suite', () => {
  it('passes all sub-tests in order', { timeout: Number.parseInt(process.env.MMC3_WALL_TIMEOUT_MS || '300000', 10) }, () => {
    const dir = path.resolve(process.env.MMC3_DIR || 'roms/nes-test-roms/mmc3_test');
    const includeMMC6 = (process.env.MMC3_INCLUDE_MMC6 ?? '1') === '1';
    const hz = Number.parseInt(process.env.MMC3_CPU_HZ || '1789773', 10);
    const timeoutCycles = (() => {
      const cyc = process.env.MMC3_TIMEOUT_CYCLES;
      if (cyc && /^\d+$/.test(cyc)) return Number.parseInt(cyc, 10);
      const secs = Number.parseInt(process.env.MMC3_TIMEOUT_SECONDS || '60', 10);
      return Math.max(1, Math.floor(hz * secs));
    })();
    const resetDelayCycles = Math.floor(hz * 0.100);

    const files = [
      '1-clocking.nes',
      '2-details.nes',
      '3-A12_clocking.nes',
      '4-scanline_timing.nes',
      '5-MMC3.nes',
      ...(includeMMC6 ? ['6-MMC6.nes'] : []),
    ];

    const missing = files.filter((f) => !fs.existsSync(path.join(dir, f)));
    expect(missing, `Missing ROMs: ${missing.join(', ')} (MMC3_DIR=${dir})`).toEqual([]);

    for (const f of files) {
      const p = path.join(dir, f);
      const res = runMmc3Rom(p, { timeoutCycles, resetDelayCycles, wallTimeoutMs: Number.parseInt(process.env.MMC3_WALL_TIMEOUT_MS || '300000', 10) });
      if (res.status !== 0) {
        const a12 = res.debug?.a12Trace ?? [];
        const mmc3 = res.debug?.mmc3Trace ?? [];
        // Print concise diagnostics for debugging
        // eslint-disable-next-line no-console
        console.error(`[MMC3 DEBUG] ${f}: status=${res.status} msg=${JSON.stringify(res.message)} cycles=${res.cycles}`);
        // eslint-disable-next-line no-console
        console.error(`[MMC3 DEBUG] sigSeen=${res.debug?.sigSeen} lastStatus=${res.debug?.lastStatus} lastMsg=${JSON.stringify(res.debug?.lastMsg || '')}`);
        // eslint-disable-next-line no-console
        console.error(`[MMC3 DEBUG] A12 rises (last ${a12.length}): ${a12.map(t => `f${t.frame}s${t.scanline}c${t.cycle}`).join(', ')}`);
        const ctrl = (res.debug as any)?.ctrlTrace ?? [];
        if (ctrl && ctrl.length) {
          const tail = ctrl.slice(-64);
          // eslint-disable-next-line no-console
          console.error(`[MMC3 DEBUG] PPUCTRL writes (last ${tail.length}/${ctrl.length}): ${tail.map((e: any)=>`@[f${e.frame}s${e.scanline}c${e.cycle}] $2000=${(e.ctrl>>>0).toString(16).padStart(2,'0')}`).join(', ')}`);
        }
        const mask = (res.debug as any)?.maskTrace ?? [];
        if (mask && mask.length) {
          const tailm = mask.slice(-64);
          // eslint-disable-next-line no-console
          console.error(`[MMC3 DEBUG] PPUMASK writes (last ${tailm.length}/${mask.length}): ${tailm.map((e: any)=>`@[f${e.frame}s${e.scanline}c${e.cycle}] $2001=${(e.mask>>>0).toString(16).padStart(2,'0')}`).join(', ')}`);
        }
        if (mmc3 && (mmc3 as any).length) {
          const arr: any[] = mmc3 as any;
          const head = arr.slice(0, Math.min(16, arr.length));
          const tail = arr.slice(Math.max(0, arr.length - 32));
          const counts = arr.reduce((m: Record<string, number>, e: any) => { m[e.type] = (m[e.type]||0)+1; return m; }, {} as Record<string, number>);
          // eslint-disable-next-line no-console
          console.error(`[MMC3 DEBUG] MMC3 trace counts: ${Object.entries(counts).map(([k,v])=>`${k}:${v}`).join(', ')}`);
          // Show context around first IRQ, if any
          const irqIdx = arr.findIndex((e: any) => e.type === 'IRQ');
          if (irqIdx >= 0) {
            const s = Math.max(0, irqIdx - 6), e = Math.min(arr.length, irqIdx + 7);
            const window = arr.slice(s, e);
            // eslint-disable-next-line no-console
          console.error(`[MMC3 DEBUG] around IRQ@${irqIdx}: ${window.map((e: any) => e.type + (e.ctr!==undefined?`(ctr=${e.ctr}${e.en!==undefined?`,en=${e.en}`:''})`:'' ) + (e.v!==undefined?` v=${e.v}`:'' ) + (e.a!==undefined?` a=${e.a}`:'' ) + (e.f!==undefined?` @[f${e.f}s${e.s}c${e.c}]`:'' )).join(' | ')}`);
          }
          // eslint-disable-next-line no-console
          console.error(`[MMC3 DEBUG] MMC3 trace (first ${head.length}): ${head.map((e: any) => e.type + (e.ctr!==undefined?`(ctr=${e.ctr}${e.en!==undefined?`,en=${e.en}`:''})`:'' ) + (e.v!==undefined?` v=${e.v}`:'' ) + (e.a!==undefined?` a=${e.a}`:'' ) + (e.f!==undefined?` @[f${e.f}s${e.s}c${e.c}]`:'' )).join(' | ')}`);
          // eslint-disable-next-line no-console
          console.error(`[MMC3 DEBUG] MMC3 trace (last ${tail.length}): ${tail.map((e: any) => e.type + (e.ctr!==undefined?`(ctr=${e.ctr}${e.en!==undefined?`,en=${e.en}`:''})`:'' ) + (e.v!==undefined?` v=${e.v}`:'' ) + (e.a!==undefined?` a=${e.a}`:'' ) + (e.f!==undefined?` @[f${e.f}s${e.s}c${e.c}]`:'' )).join(' | ')}`);
        }
      }
      expect(res.status, `ROM ${f} reported message: ${res.message}`).toBe(0);
    }
  });
});

