/*
Focused harness: run only 1-clocking.nes from MMC3 test 2 (rom_singles) and dump compact telemetry on failure.
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

type A12Entry = { frame: number; scanline: number; cycle: number };
type CtrlEntry = { frame: number; scanline: number; cycle: number; ctrl: number };
type MaskEntry = { frame: number; scanline: number; cycle: number; mask: number };
type MMC3Entry = { type: string; a?: number; v?: number; ctr?: number; en?: boolean; f?: number; s?: number; c?: number; ctrl?: number; op?: string; pre?: boolean };

const hasSignature = (sys: NESSystem): boolean =>
  sys.bus.read(SIG_ADDR) === SIG0 &&
  sys.bus.read((SIG_ADDR + 1) & 0xffff) === SIG1 &&
  sys.bus.read((SIG_ADDR + 2) & 0xffff) === SIG2;

const readText = (sys: NESSystem, addr: number = TEXT_ADDR, max: number = 512): string => {
  let s = '';
  for (let i = 0; i < max; i++) {
    const ch = sys.bus.read((addr + i) & 0xffff);
    if (ch === 0) break;
    s += String.fromCharCode(ch);
  }
  return s;
};

const run = (romPath: string, timeoutCycles: number, resetDelayCycles: number, wallTimeoutMs: number) => {
  const buf = new Uint8Array(fs.readFileSync(romPath));
  const rom = parseINes(buf);
  process.env.DISABLE_APU_IRQ = '1';
  const sys = new NESSystem(rom);
  sys.reset();
  sys.bus.write(0xA001, 0x80); // enable PRG-RAM for status

  const start = sys.cpu.state.cycles;
  const deadline = start + timeoutCycles;
  const wallDeadline = Date.now() + wallTimeoutMs;
  let sigSeen = false;
  let scheduledResetAt: number | null = null;

  while (sys.cpu.state.cycles < deadline) {
    sys.stepInstruction();
    if (Date.now() >= wallDeadline) break;

    if (!sigSeen) sigSeen = hasSignature(sys);

    if (scheduledResetAt !== null && sys.cpu.state.cycles >= scheduledResetAt) {
      sys.cpuResetOnly();
      scheduledResetAt = null;
      continue;
    }
    if (!sigSeen) continue;

    const status = sys.bus.read(STATUS_ADDR);
    if (status === 0x80) continue;
    if (status === 0x81) { if (scheduledResetAt === null) scheduledResetAt = sys.cpu.state.cycles + resetDelayCycles; continue; }

    const msg = readText(sys, TEXT_ADDR);
    const a12Trace = sys.ppu.getA12Trace().slice(-48) as A12Entry[];
    const ctrlTrace = sys.ppu.getCtrlTrace().slice(-96) as CtrlEntry[];
    const maskTrace = sys.ppu.getMaskTrace().slice(-96) as MaskEntry[];
    const mmc3Trace = ((sys.cart as any).mapper?.getTrace?.() ?? []) as MMC3Entry[];
    return { status, message: msg, cycles: sys.cpu.state.cycles, a12Trace, ctrlTrace, maskTrace, mmc3Trace };
  }
  return { status: 0x7F, message: '[timeout]', cycles: sys.cpu.state.cycles, a12Trace: [] as A12Entry[], ctrlTrace: [] as CtrlEntry[], maskTrace: [] as MaskEntry[], mmc3Trace: [] as MMC3Entry[] };
};

describe('MMC3 test 2: 1-clocking.nes only (diagnostic)', () => {
  it('should pass', { timeout: Number.parseInt(process.env.MMC3_WALL_TIMEOUT_MS || '300000', 10) }, () => {
    const dir = path.resolve(process.env.MMC3_2_DIR || 'roms/nes-test-roms/mmc3_test_2/rom_singles');
    const rom = path.join(dir, '1-clocking.nes');
    expect(fs.existsSync(rom), `Missing ROM: ${rom}`).toBe(true);

    const hz = Number.parseInt(process.env.MMC3_CPU_HZ || '1789773', 10);
    const timeoutCycles = (() => {
      const cyc = process.env.MMC3_TIMEOUT_CYCLES; if (cyc && /^\d+$/.test(cyc)) return Number.parseInt(cyc, 10);
      const secs = Number.parseInt(process.env.MMC3_TIMEOUT_SECONDS || '60', 10); return Math.max(1, Math.floor(hz * secs));
    })();
    const wallMs = Number.parseInt(process.env.MMC3_WALL_TIMEOUT_MS || '300000', 10);
    const resetDelayCycles = Math.floor(hz * 0.100);

    const res = run(rom, timeoutCycles, resetDelayCycles, wallMs);
    if (res.status !== 0) {
      const { a12Trace, ctrlTrace, maskTrace, mmc3Trace } = res;
      // Summaries
      const counts = mmc3Trace.reduce((m: Record<string, number>, e) => { m[e.type] = (m[e.type]||0)+1; return m; }, {} as Record<string, number>);
      // eslint-disable-next-line no-console
      console.error(`[1-clocking2 DEBUG] status=${res.status} msg=${JSON.stringify(res.message)} cycles=${res.cycles}`);
      // eslint-disable-next-line no-console
      console.error(`[1-clocking2 DEBUG] MMC3 counts: ${Object.entries(counts).map(([k,v])=>`${k}:${v}`).join(', ')}`);
      // Tail windows
      const a12Tail = a12Trace.slice(-24);
      const mmcTail = mmc3Trace.slice(Math.max(0, mmc3Trace.length - 64));
      const ctrlTail = ctrlTrace.slice(-24);
      const maskTail = maskTrace.slice(-24);
      // eslint-disable-next-line no-console
      console.error(`[1-clocking2 DEBUG] A12 tail (${a12Tail.length}): ${a12Tail.map(t=>`f${t.frame}s${t.scanline}c${t.cycle}`).join(' | ')}`);
      // eslint-disable-next-line no-console
      console.error(`[1-clocking2 DEBUG] ctrl tail (${ctrlTail.length}): ${ctrlTail.map(e=>`@[f${e.frame}s${e.scanline}c${e.cycle}] $2000=${(e.ctrl>>>0).toString(16).padStart(2,'0')}`).join(' | ')}`);
      // eslint-disable-next-line no-console
      console.error(`[1-clocking2 DEBUG] mask tail (${maskTail.length}): ${maskTail.map(e=>`@[f${e.frame}s${e.scanline}c${e.cycle}] $2001=${(e.mask>>>0).toString(16).padStart(2,'0')}`).join(' | ')}`);
      // Focused window around first dec->0 and first IRQ
      const a12s = mmc3Trace.filter(e=>e.type==='A12');
      const firstDec0 = a12s.findIndex((e:any)=> e.op==='dec' && e.ctr===0);
      if (firstDec0 >= 0) {
        const s = Math.max(0, firstDec0 - 8), e = Math.min(a12s.length, firstDec0 + 9); const win = a12s.slice(s, e);
        console.error(`[1-clocking2 DEBUG] around first dec->0 @${firstDec0}: ${win.map((e:any)=>`op=${e.op} ctr=${e.ctr}${e.en!==undefined?` en=${e.en}`:''}${(e.f!==undefined)?` @[f${e.f}s${e.s}c${e.c}]`:''}`).join(' | ')}`);
      }
      const irqIdx = mmc3Trace.findIndex(e=>e.type==='IRQ');
      if (irqIdx >= 0) {
        const s = Math.max(0, irqIdx - 12), e = Math.min(mmc3Trace.length, irqIdx + 13);
        const win = mmc3Trace.slice(s, e);
        console.error(`[1-clocking2 DEBUG] around first IRQ @${irqIdx}: ${win.map((e:any)=> e.type + (e.ctr!==undefined?`(ctr=${e.ctr}${e.en!==undefined?`,en=${e.en}`:''})`:'' ) + (e.v!==undefined?` v=${e.v}`:'' ) + (e.a!==undefined?` a=${e.a}`:'' ) + (e.ctrl!==undefined?` ctrl=${(e.ctrl>>>0).toString(16).padStart(2,'0')}`:'' ) + (e.f!==undefined?` @[f${e.f}s${e.s}c${e.c}]`:'' )).join(' | ')}`);
      }
    }
    expect(res.status, `ROM reported: ${res.message}`).toBe(0);
  });
});
