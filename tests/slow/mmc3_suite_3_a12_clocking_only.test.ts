/*
Run only 3-A12_clocking.nes from the MMC3 test suite and print detailed diagnostics on failure.
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

function runMmc3Rom(romPath: string, timeoutCycles: number, resetDelayCycles: number) {
  const buf = new Uint8Array(fs.readFileSync(romPath));
  const rom = parseINes(buf);
  (process as any).env.DISABLE_APU_IRQ = '1';
  const sys = new NESSystem(rom);
  sys.reset();
  sys.bus.write(0xA001, 0x80); // enable PRG-RAM

  const start = sys.cpu.state.cycles;
  const deadline = start + timeoutCycles;
  let sigSeen = false;
  let scheduledResetAt: number | null = null;

  while (sys.cpu.state.cycles < deadline) {
    sys.stepInstruction();

    if (!sigSeen) sigSeen = hasSignature(sys);

    if (scheduledResetAt !== null && sys.cpu.state.cycles >= scheduledResetAt) {
      sys.cpuResetOnly();
      scheduledResetAt = null;
      continue;
    }

    if (!sigSeen) continue;

    const status = sys.bus.read(STATUS_ADDR);
    if (status === 0x80) continue;
    if (status === 0x81) {
      if (scheduledResetAt === null) scheduledResetAt = sys.cpu.state.cycles + resetDelayCycles;
      continue;
    }
    const msg = readText(sys, TEXT_ADDR);
    return {
      status,
      message: msg,
      cycles: sys.cpu.state.cycles,
      a12Trace: sys.ppu.getA12Trace().slice(-64),
      ctrlTrace: (sys.ppu as any).getCtrlTrace?.() ?? [],
      maskTrace: (sys.ppu as any).getMaskTrace?.() ?? [],
      phaseTrace: (sys.ppu as any).getPhaseTrace?.() ?? [],
      mmc3Trace: ((sys.cart as any).mapper && (typeof (sys.cart as any).mapper.getTrace === 'function')) ? (sys.cart as any).mapper.getTrace() : null,
    };
  }
  return { status: 0x7F, message: '[timeout]', cycles: sys.cpu.state.cycles, a12Trace: [], ctrlTrace: [], maskTrace: [], mmc3Trace: null };
}

describe('MMC3: 3-A12_clocking.nes only', () => {
  it('should pass', () => {
    const dir = path.resolve(process.env.MMC3_DIR || 'roms/nes-test-roms/mmc3_test');
    const hz = Number.parseInt(process.env.MMC3_CPU_HZ || '1789773', 10);
    const timeoutCycles = Number.parseInt(process.env.MMC3_TIMEOUT_CYCLES || '25000000', 10);
    const resetDelayCycles = Math.floor(hz * 0.100);
    const rom = path.join(dir, '3-A12_clocking.nes');
    expect(fs.existsSync(rom), `Missing ROM: ${rom}`).toBe(true);

    const res = runMmc3Rom(rom, timeoutCycles, resetDelayCycles);
    if (res.status !== 0) {
      const a12 = res.a12Trace ?? [];
      const mmc3 = res.mmc3Trace ?? [];
      // eslint-disable-next-line no-console
      console.error(`[3-A12_clocking DEBUG] status=${res.status} msg=${JSON.stringify(res.message)} cycles=${res.cycles}`);
      // eslint-disable-next-line no-console
      console.error(`[3-A12_clocking DEBUG] A12 rises (last ${a12.length}): ${a12.map(t => `f${t.frame}s${t.scanline}c${t.cycle}`).join(', ')}`);
      const ctrl = (res as any).ctrlTrace ?? [];
      const mask = (res as any).maskTrace ?? [];
      if (ctrl && ctrl.length) {
        const tailc = ctrl.slice(-32);
        // eslint-disable-next-line no-console
        console.error(`[3-A12_clocking DEBUG] PPUCTRL writes (last ${tailc.length}/${ctrl.length}): ${tailc.map((e: any)=>`@[f${e.frame}s${e.scanline}c${e.cycle}] $2000=${(e.ctrl>>>0).toString(16).padStart(2,'0')}`).join(', ')}`);
      }
      if (mask && mask.length) {
        const tailm = mask.slice(-32);
        // eslint-disable-next-line no-console
        console.error(`[3-A12_clocking DEBUG] PPUMASK writes (last ${tailm.length}/${mask.length}): ${tailm.map((e: any)=>`@[f${e.frame}s${e.scanline}c${e.cycle}] $2001=${(e.mask>>>0).toString(16).padStart(2,'0')}`).join(', ')}`);
      }
      if (mmc3 && (mmc3 as any).length) {
        // Also dump PPU phase telemetry if available
        const phase = (res as any).phaseTrace ?? [];
        if (phase && phase.length) {
          const tailp = phase.slice(-12);
          // eslint-disable-next-line no-console
          console.error(`[3-A12_clocking DEBUG] PPU phase trace (last ${tailp.length}): ${tailp.map((e: any)=>`@[f${e.frame}s${e.scanline}c${e.cycle}] ctrl=${(e.ctrl>>>0).toString(16).padStart(2,'0')} mask=${(e.mask>>>0).toString(16).padStart(2,'0')}${e.emitted!==undefined?` emitted=${e.emitted}`:''}`).join(' | ')}`);
        }
        const arr: any[] = mmc3 as any;
        const counts = arr.reduce((m: Record<string, number>, e: any) => { m[e.type] = (m[e.type]||0)+1; return m; }, {} as Record<string, number>);
        // eslint-disable-next-line no-console
        console.error(`[3-A12_clocking DEBUG] MMC3 trace counts: ${Object.entries(counts).map(([k,v])=>`${k}:${v}`).join(', ')}`);
        const tail = arr.slice(Math.max(0, arr.length - 32));
        // eslint-disable-next-line no-console
        console.error(`[3-A12_clocking DEBUG] MMC3 trace (last ${tail.length}): ${tail.map((e: any) => e.type + (e.ctr!==undefined?`(ctr=${e.ctr}${e.en!==undefined?`,en=${e.en}`:''})`:'' ) + (e.v!==undefined?` v=${e.v}`:'' ) + (e.a!==undefined?` a=${e.a}`:'' ) + (e.f!==undefined?` @[f${e.f}s${e.s}c${e.c}]`:'' )).join(' | ')}`);
      }
    }
    expect(res.status, `ROM reported: ${res.message}`).toBe(0);
  });
});
