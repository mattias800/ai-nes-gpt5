import fs from 'node:fs';
import path from 'node:path';
import { parseINes } from '@core/cart/ines';
import { NESSystem } from '@core/system/system';

const STATUS_ADDR = 0x6000;
const SIG_ADDR = 0x6001; //..6003
const TEXT_ADDR = 0x6004;
const SIG0 = 0xde, SIG1 = 0xb0, SIG2 = 0x61;

const hasSignature = (sys: NESSystem): boolean => {
  const b0 = sys.bus.read(SIG_ADDR);
  const b1 = sys.bus.read((SIG_ADDR + 1) & 0xffff);
  const b2 = sys.bus.read((SIG_ADDR + 2) & 0xffff);
  return b0 === SIG0 && b1 === SIG1 && b2 === SIG2;
};

const readText = (sys: NESSystem, addr = TEXT_ADDR, max = 512): string => {
  let s = '';
  for (let i = 0; i < max; i++) {
    const ch = sys.bus.read((addr + i) & 0xffff);
    if (ch === 0) break;
    s += String.fromCharCode(ch);
  }
  return s;
};

const main = async () => {
  const dir = path.resolve(process.env.MMC3_DIR || 'roms/nes-test-roms/mmc3_test');
  const romPath = path.join(dir, '4-scanline_timing.nes');
  if (!fs.existsSync(romPath)) {
    console.error(`[snoop] Missing ROM: ${romPath}`);
    process.exitCode = 2;
    return;
  }
  const hz = Number.parseInt(process.env.MMC3_CPU_HZ || '1789773', 10);
  const timeoutCycles = Number.parseInt(process.env.MMC3_TIMEOUT_CYCLES || '80000000', 10);
  const resetDelayCycles = Math.floor(hz * 0.100);

  (process as any).env.DISABLE_APU_IRQ = '1';
  const rom = parseINes(new Uint8Array(fs.readFileSync(romPath)));
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
    if (status === 0x80) continue; // running
    if (status === 0x81) { // request warm reset soon
      if (scheduledResetAt === null) scheduledResetAt = sys.cpu.state.cycles + resetDelayCycles;
      continue;
    }
    const msg = readText(sys, TEXT_ADDR);
    console.log(`[snoop] PASS status=${status} message=${JSON.stringify(msg)} cycles=${sys.cpu.state.cycles}`);
    dumpTraces(sys);
    process.exitCode = 0;
    return;
  }

  console.error(`[snoop] TIMEOUT at cycles=${sys.cpu.state.cycles}`);
  dumpTraces(sys);
  process.exitCode = 1;
};

function dumpTraces(sys: NESSystem) {
  const ppu: any = sys.ppu as any;
  const mapper: any = (sys.cart as any).mapper;
  const a12Trace = ppu.getA12Trace?.() ?? [];
  const ctrlTrace = ppu.getCtrlTrace?.() ?? [];
  const maskTrace = ppu.getMaskTrace?.() ?? [];
  const phaseTrace = ppu.getPhaseTrace?.() ?? [];
  const mmc3Trace = (typeof mapper.getTrace === 'function') ? mapper.getTrace() : [];

  console.error(`[snoop] A12 rises (last ${a12Trace.length}): ${a12Trace.slice(-32).map((t: any) => `f${t.frame}s${t.scanline}c${t.cycle}`).join(', ')}`);
  if (ctrlTrace.length) console.error(`[snoop] PPUCTRL writes (last ${Math.min(ctrlTrace.length, 32)}/${ctrlTrace.length}): ${ctrlTrace.slice(-32).map((e: any)=>`@[f${e.frame}s${e.scanline}c${e.cycle}] $2000=${(e.ctrl>>>0).toString(16).padStart(2,'0')}`).join(', ')}`);
  if (maskTrace.length) console.error(`[snoop] PPUMASK writes (last ${Math.min(maskTrace.length, 32)}/${maskTrace.length}): ${maskTrace.slice(-32).map((e: any)=>`@[f${e.frame}s${e.scanline}c${e.cycle}] $2001=${(e.mask>>>0).toString(16).padStart(2,'0')}`).join(', ')}`);
  if (phaseTrace.length) console.error(`[snoop] PPU phase (last ${Math.min(phaseTrace.length, 12)}): ${phaseTrace.slice(-12).map((e: any)=>`@[f${e.frame}s${e.scanline}c${e.cycle}] ctrl=${(e.ctrl>>>0).toString(16).padStart(2,'0')} mask=${(e.mask>>>0).toString(16).padStart(2,'0')}${e.emitted!==undefined?` emitted=${e.emitted}`:''}`).join(' | ')}`);

  const counts = (mmc3Trace as any[]).reduce((m: Record<string, number>, e: any) => { m[e.type] = (m[e.type]||0)+1; return m; }, {} as Record<string, number>);
  console.error(`[snoop] MMC3 trace counts: ${Object.entries(counts).map(([k,v])=>`${k}:${v}`).join(', ')}`);

  const tail = (mmc3Trace as any[]).slice(Math.max(0, (mmc3Trace as any[]).length - 48));
  console.error(`[snoop] MMC3 tail: ${tail.map((e: any) => e.type + (e.ctr!==undefined?`(ctr=${e.ctr}${e.en!==undefined?`,en=${e.en}`:''})`:'' ) + (e.v!==undefined?` v=${e.v}`:'' ) + (e.a!==undefined?` a=${e.a}`:'' ) + (e.ctrl!==undefined?` ctrl=${(e.ctrl>>>0).toString(16).padStart(2,'0')}`:'' ) + (e.f!==undefined?` @[f${e.f}s${e.s}c${e.c}]`:'' )).join(' | ')}`);

  const idxE001 = (mmc3Trace as any[]).findIndex((e: any) => e.type === 'E001');
  const idxIRQ = (mmc3Trace as any[]).findIndex((e: any) => e.type === 'IRQ');
  console.error(`[snoop] first E001 index=${idxE001}, first IRQ index=${idxIRQ}`);
  if (idxE001 >= 0) {
    const window = (mmc3Trace as any[]).slice(Math.max(0, idxE001 - 10), Math.min((mmc3Trace as any[]).length, idxE001 + 50));
    console.error(`[snoop] around E001: ${window.map((e: any) => e.type + (e.ctr!==undefined?`(ctr=${e.ctr}${e.en!==undefined?`,en=${e.en}`:''})`:'' ) + (e.v!==undefined?` v=${e.v}`:'' ) + (e.a!==undefined?` a=${e.a}`:'' ) + (e.ctrl!==undefined?` ctrl=${(e.ctrl>>>0).toString(16).padStart(2,'0')}`:'' ) + (e.f!==undefined?` @[f${e.f}s${e.s}c${e.c}]`:'' )).join(' | ')}`);
  }
}

main().catch((e)=>{ console.error(e); process.exitCode = 1; });
