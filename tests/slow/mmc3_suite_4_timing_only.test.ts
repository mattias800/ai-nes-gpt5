/*
Run only 4-scanline_timing.nes from the MMC3 test suite and print detailed diagnostics on failure.
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

function runMmc3Rom(romPath: string, timeoutCycles: number, resetDelayCycles: number, wallTimeoutMs?: number) {
  const buf = new Uint8Array(fs.readFileSync(romPath));
  const rom = parseINes(buf);
  (process as any).env.DISABLE_APU_IRQ = '1';
  const sys = new NESSystem(rom);
  sys.reset();
  sys.bus.write(0xA001, 0x80); // enable PRG-RAM

  const start = sys.cpu.state.cycles;
  const deadline = start + timeoutCycles;
  const wallDeadline = Date.now() + (wallTimeoutMs ?? Number.parseInt(process.env.MMC3_WALL_TIMEOUT_MS || '300000', 10));
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

    if (!sigSeen) { if (Date.now() >= wallDeadline) break; continue; }

    if (Date.now() >= wallDeadline) break;

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

describe('MMC3: 4-scanline_timing.nes only', () => {
  it('should pass', { timeout: Number.parseInt(process.env.MMC3_WALL_TIMEOUT_MS || '300000', 10) }, () => {
    const dir = path.resolve(process.env.MMC3_DIR || 'roms/nes-test-roms/mmc3_test');
    const hz = Number.parseInt(process.env.MMC3_CPU_HZ || '1789773', 10);
    const wallMs = Number.parseInt(process.env.MMC3_WALL_TIMEOUT_MS || '300000', 10);
    const timeoutCycles = (() => {
      const cyc = process.env.MMC3_TIMEOUT_CYCLES;
      if (cyc && /^\d+$/.test(cyc)) return Number.parseInt(cyc, 10);
      const secs = Number.parseInt(process.env.MMC3_TIMEOUT_SECONDS || '60', 10);
      return Math.max(1, Math.floor(hz * secs));
    })();
    const resetDelayCycles = Math.floor(hz * 0.100);
    const rom = path.join(dir, '4-scanline_timing.nes');
    expect(fs.existsSync(rom), `Missing ROM: ${rom}`).toBe(true);

    const res = runMmc3Rom(rom, timeoutCycles, resetDelayCycles, wallMs);
    if (res.status !== 0) {
      const a12 = res.a12Trace ?? [];
      const mmc3 = res.mmc3Trace ?? [];
      // eslint-disable-next-line no-console
      console.error(`[4-scanline DEBUG] status=${res.status} msg=${JSON.stringify(res.message)} cycles=${res.cycles}`);
      // eslint-disable-next-line no-console
      console.error(`[4-scanline DEBUG] A12 rises (last ${a12.length}): ${a12.map(t => `f${t.frame}s${t.scanline}c${t.cycle}`).join(', ')}`);
      const ctrl = (res as any).ctrlTrace ?? [];
      const mask = (res as any).maskTrace ?? [];
      if (ctrl && ctrl.length) {
        const tailc = ctrl.slice(-32);
        // eslint-disable-next-line no-console
        console.error(`[4-scanline DEBUG] PPUCTRL writes (last ${tailc.length}/${ctrl.length}): ${tailc.map((e: any)=>`@[f${e.frame}s${e.scanline}c${e.cycle}] $2000=${(e.ctrl>>>0).toString(16).padStart(2,'0')}`).join(', ')}`);
        const ctrl10 = ctrl.filter((e:any)=>((e.ctrl>>>0)&0x10)!==0);
        const ctrl08 = ctrl.filter((e:any)=>((e.ctrl>>>0)&0x08)!==0);
        const tail10 = ctrl10.slice(-8), tail08 = ctrl08.slice(-8);
        console.error(`[4-scanline DEBUG] PPUCTRL bit10 writes: count=${ctrl10.length} tail=${tail10.map((e:any)=>`@[f${e.frame}s${e.scanline}c${e.cycle}]` ).join(', ')}`);
        console.error(`[4-scanline DEBUG] PPUCTRL bit08 writes: count=${ctrl08.length} tail=${tail08.map((e:any)=>`@[f${e.frame}s${e.scanline}c${e.cycle}]` ).join(', ')}`);
      }
      if (mask && mask.length) {
        const tailm = mask.slice(-32);
        // eslint-disable-next-line no-console
        console.error(`[4-scanline DEBUG] PPUMASK writes (last ${tailm.length}/${mask.length}): ${tailm.map((e: any)=>`@[f${e.frame}s${e.scanline}c${e.cycle}] $2001=${(e.mask>>>0).toString(16).padStart(2,'0')}`).join(', ')}`);
      }
      if (mmc3 && (mmc3 as any).length) {
        // Also dump PPU phase telemetry if available
        const phase = (res as any).phaseTrace ?? [];
        if (phase && phase.length) {
          const tailp = phase.slice(-12);
          // eslint-disable-next-line no-console
          console.error(`[4-scanline DEBUG] PPU phase trace (last ${tailp.length}): ${tailp.map((e: any)=>`@[f${e.frame}s${e.scanline}c${e.cycle}] ctrl=${(e.ctrl>>>0).toString(16).padStart(2,'0')} mask=${(e.mask>>>0).toString(16).padStart(2,'0')}${e.emitted!==undefined?` emitted=${e.emitted}`:''}`).join(' | ')}`);
        }
        const arr: any[] = mmc3 as any;
        const counts = arr.reduce((m: Record<string, number>, e: any) => { m[e.type] = (m[e.type]||0)+1; return m; }, {} as Record<string, number>);
        // eslint-disable-next-line no-console
        console.error(`[4-scanline DEBUG] MMC3 trace counts: ${Object.entries(counts).map(([k,v])=>`${k}:${v}`).join(', ')}`);
        // Try to identify first s0 IRQ after an E001 enable for both $2000=$08 (sprites@$1000) and $2000=$10 (bg@$1000)
        const e001Idxs = arr.map((e,i)=>({e,i})).filter(x=>x.e.type==='E001').map(x=>x.i);
        type IRQHit = { mode: 'sp08'|'bg10'|'other', f: number, s: number, c: number, ctrl: number, e001Idx: number };
        const hits: IRQHit[] = [];
        for (const idx of e001Idxs) {
          const e001 = arr[idx];
          // find next IRQ at scanline 0 after E001 (scan to end; robust to truncation)
          let hit: any = null;
          for (let j = idx+1; j < arr.length; j++) {
            const e = arr[j];
            if (e.type==='IRQ' && e.s===0) { hit = e; break; }
          }
          // find first A12 on scanline 0 after E001 (scan to end; robust to truncation)
          let firstA12s0: any = null;
          for (let j = idx+1; j < arr.length; j++) {
            const e = arr[j];
            if (e.type==='A12' && e.s===0) { firstA12s0 = e; break; }
          }
          const tsBefore = (a: any, b: any) => (a.f < b.f) || (a.f===b.f && (a.s < b.s || (a.s===b.s && a.c <= b.c)));
          let lastCtrlAtIRQ = 0x00, lastCtrlAtA12 = 0x00;
          let lastMaskAtIRQ = 0x00, lastMaskAtA12 = 0x00;
          for (const w of ctrl) {
            const wts = { f:w.frame, s:w.scanline, c:w.cycle };
            if (hit && tsBefore(wts, hit)) lastCtrlAtIRQ = w.ctrl >>> 0;
            if (firstA12s0 && tsBefore(wts, firstA12s0)) lastCtrlAtA12 = w.ctrl >>> 0;
          }
          for (const m of mask) {
            const mts = { f:m.frame, s:m.scanline, c:m.cycle };
            if (hit && tsBefore(mts, hit)) lastMaskAtIRQ = m.mask >>> 0;
            if (firstA12s0 && tsBefore(mts, firstA12s0)) lastMaskAtA12 = m.mask >>> 0;
          }
          if (hit) {
            const mode: IRQHit['mode'] = (lastCtrlAtIRQ & 0x08) ? 'sp08' : ((lastCtrlAtIRQ & 0x10) ? 'bg10' : 'other');
            hits.push({ mode, f: hit.f, s: hit.s, c: hit.c, ctrl: lastCtrlAtIRQ, e001Idx: idx });
          }
          const ctrlAtE001 = (e001.ctrl>>>0) || 0;
          const mk = (v: number) => `${v.toString(16).padStart(2,'0')} (bg=${(v&0x08)?1:0},sp=${(v&0x10)?1:0})`;
          // eslint-disable-next-line no-console
          console.error(`[4-scanline DEBUG] E001@${idx} (ctrl=${ctrlAtE001.toString(16).padStart(2,'0')}): next s0 A12 ${firstA12s0?`@f${firstA12s0.f}s${firstA12s0.s}c${firstA12s0.c} (ctrl=${lastCtrlAtA12.toString(16).padStart(2,'0')}, mask=${mk(lastMaskAtA12)})`:'(none)'} | next s0 IRQ ${hit?`@f${hit.f}s${hit.s}c${hit.c} (ctrl=${lastCtrlAtIRQ.toString(16).padStart(2,'0')}, mask=${mk(lastMaskAtIRQ)})`:'(none)'}`);
        }
        const firstSp = hits.find(h=>h.mode==='sp08');
        const firstBg = hits.find(h=>h.mode==='bg10');
        if (firstSp || firstBg) {
          // eslint-disable-next-line no-console
          console.error(`[4-scanline DEBUG] paired first-s0 IRQs by mode: sp08=${firstSp?`f${firstSp.f}s${firstSp.s}c${firstSp.c}`:'(none)'} bg10=${firstBg?`f${firstBg.f}s${firstBg.s}c${firstBg.c}`:'(none)'} (scanned-to-end)`);
          if (firstSp && firstBg) {
            // eslint-disable-next-line no-console
            console.error(`[4-scanline DEBUG] comparison: sp08.c(${firstSp.c}) ${firstSp.c<firstBg.c?'<':'>'} bg10.c(${firstBg.c})`);
          }
        }

        // Fallback path if no E001 present in trace: report earliest s0 IRQ/A12 overall
        if (!e001Idxs.length) {
          const earliestS0Irq = arr.find((e: any)=> e.type==='IRQ' && e.s===0);
          const earliestS0A12 = arr.find((e: any)=> e.type==='A12' && e.s===0);
          // eslint-disable-next-line no-console
          console.error(`[4-scanline DEBUG] fallback(no-E001-in-trace): earliest s0 IRQ=${earliestS0Irq?`f${earliestS0Irq.f}s${earliestS0Irq.s}c${earliestS0Irq.c}`:'(none)'} earliest s0 A12=${earliestS0A12?`f${earliestS0A12.f}s${earliestS0A12.s}c${earliestS0A12.c}`:'(none)'} `);
        }
        // Also classify by PPUMASK at the time of the hit (bg-only vs sp-only)
        const maskTrace = mask as any[];
        const tsBefore = (a: any, b: any) => (a.f < b.f) || (a.f===b.f && (a.s < b.s || (a.s===b.s && a.c <= b.c)));
        const s0IrqsAll = arr.filter(e=>e.type==='IRQ' && e.s===0);
        let earliestSpOnly: any = null, earliestBgOnly: any = null;
        for (const hit of s0IrqsAll) {
          let lastMask = 0x00;
          for (const w of maskTrace) {
            const wts = { f:w.frame, s:w.scanline, c:w.cycle };
            if (tsBefore(wts, hit)) lastMask = w.mask>>>0;
          }
          const spOn = (lastMask & 0x10)!==0;
          const bgOn = (lastMask & 0x08)!==0;
          if (spOn && !bgOn && (!earliestSpOnly || hit.f < earliestSpOnly.f || (hit.f===earliestSpOnly.f && hit.c < earliestSpOnly.c))) earliestSpOnly = hit;
          if (bgOn && !spOn && (!earliestBgOnly || hit.f < earliestBgOnly.f || (hit.f===earliestBgOnly.f && hit.c < earliestBgOnly.c))) earliestBgOnly = hit;
        }
        console.error(`[4-scanline DEBUG] earliest s0 IRQ by PPUMASK: spOnly=${earliestSpOnly?`f${earliestSpOnly.f}s${earliestSpOnly.s}c${earliestSpOnly.c}`:'(none)'} bgOnly=${earliestBgOnly?`f${earliestBgOnly.f}s${earliestBgOnly.s}c${earliestBgOnly.c}`:'(none)'}`);
        // Alternative classification: earliest s0 IRQ overall by mode, not constrained to immediate E001
        const s0Irqs = arr.filter(e=>e.type==='IRQ' && e.s===0);
        let earliestSp: any = null, earliestBg: any = null;
        for (const hit of s0Irqs) {
          // classify by last PPUCTRL before hit
          const tsBefore = (a: any, b: any) => (a.f < b.f) || (a.f===b.f && (a.s < b.s || (a.s===b.s && a.c <= b.c)));
          let lastCtrl = 0x00;
          for (const w of ctrl) {
            const wts = { f:w.frame, s:w.scanline, c:w.cycle };
            if (tsBefore(wts, hit)) lastCtrl = w.ctrl >>> 0;
          }
          if ((lastCtrl & 0x08) && (!earliestSp || hit.f < earliestSp.f || (hit.f===earliestSp.f && hit.c < earliestSp.c))) {
            earliestSp = { ...hit };
          }
          if ((lastCtrl & 0x10) && (!earliestBg || hit.f < earliestBg.f || (hit.f===earliestBg.f && hit.c < earliestBg.c))) {
            earliestBg = { ...hit };
          }
        }
        // eslint-disable-next-line no-console
        console.error(`[4-scanline DEBUG] earliest overall by mode: sp08=${earliestSp?`f${earliestSp.f}s${earliestSp.s}c${earliestSp.c}`:'(none)'} bg10=${earliestBg?`f${earliestBg.f}s${earliestBg.s}c${earliestBg.c}`:'(none)'}`);
        // Also report earliest scanline-0 A12 events by mode
        const s0A12s = arr.filter(e=>e.type==='A12' && e.s===0);
        let earliestSpA12: any = null, earliestBgA12: any = null;
        for (const ev of s0A12s) {
          const lastCtrl = ev.ctrl>>>0;
          if ((lastCtrl & 0x08) && (!earliestSpA12 || ev.f < earliestSpA12.f || (ev.f===earliestSpA12.f && ev.c < earliestSpA12.c))) earliestSpA12 = ev;
          if ((lastCtrl & 0x10) && (!earliestBgA12 || ev.f < earliestBgA12.f || (ev.f===earliestBgA12.f && ev.c < earliestBgA12.c))) earliestBgA12 = ev;
        }
        // eslint-disable-next-line no-console
        console.error(`[4-scanline DEBUG] earliest s0 A12 by mode: sp08=${earliestSpA12?`f${earliestSpA12.f}s${earliestSpA12.s}c${earliestSpA12.c}`:'(none)'} bg10=${earliestBgA12?`f${earliestBgA12.f}s${earliestBgA12.s}c${earliestBgA12.c}`:'(none)'}`);
        // Print window around first IRQ, if any
        const irqIdx = arr.findIndex((e: any) => e.type === 'IRQ');
        if (irqIdx >= 0) {
          const sidx = Math.max(0, irqIdx - 10), eidx = Math.min(arr.length, irqIdx + 11);
          const win = arr.slice(sidx, eidx);
          // eslint-disable-next-line no-console
console.error(`[4-scanline DEBUG] around first IRQ@${irqIdx}: ${win.map((e: any) => e.type + (e.ctr!==undefined?`(ctr=${e.ctr}${e.en!==undefined?`,en=${e.en}`:''})`:'' ) + (e.v!==undefined?` v=${e.v}`:'' ) + (e.a!==undefined?` a=${e.a}`:'' ) + (e.ctrl!==undefined?` ctrl=${(e.ctrl>>>0).toString(16).padStart(2,'0')}`:'' ) + (e.f!==undefined?` @[f${e.f}s${e.s}c${e.c}]`:'' )).join(' | ')}`);
          const first = arr[irqIdx];
          const frame = first.f, scanline = first.s;
          const a12InLine = arr.filter((e: any) => e.type === 'A12' && e.f === frame && e.s === 0);
          // eslint-disable-next-line no-console
          console.error(`[4-scanline DEBUG] A12 events on scanline 0 in frame f${frame}: ${a12InLine.map((e: any)=>`c${e.c}(ctr=${e.ctr},en=${e.en})`).join(', ')}`);
          // Find last E001 before first A12 on s0
          const firstA12_s0 = arr.findIndex((e: any)=> e.type==='A12' && e.s===0);
          if (firstA12_s0 > 0) {
            let lastE001 = -1, lastE000 = -1, lastC001 = -1, lastC000 = -1;
            for (let i = Math.max(0, firstA12_s0 - 100); i < firstA12_s0; i++) {
              const t = arr[i].type;
              if (t==='E001') lastE001 = i; else if (t==='E000') lastE000 = i; else if (t==='C001') lastC001 = i; else if (t==='C000') lastC000 = i;
            }
            // eslint-disable-next-line no-console
            console.error(`[4-scanline DEBUG] preceding regs: C000@${lastC000}, C001@${lastC001}, E000@${lastE000}, E001@${lastE001}`);
            const regsWinStart = Math.max(0, Math.max(lastE001, lastE000, lastC001, lastC000) - 4);
            const regsWinEnd = Math.min(arr.length, firstA12_s0 + 6);
            const regsWin = arr.slice(regsWinStart, regsWinEnd);
            // eslint-disable-next-line no-console
console.error(`[4-scanline DEBUG] window around first s0 A12: ${regsWin.map((e: any) => e.type + (e.ctr!==undefined?`(ctr=${e.ctr}${e.en!==undefined?`,en=${e.en}`:''})`:'' ) + (e.v!==undefined?` v=${e.v}`:'' ) + (e.a!==undefined?` a=${e.a}`:'' ) + (e.ctrl!==undefined?` ctrl=${(e.ctrl>>>0).toString(16).padStart(2,'0')}`:'' ) + (e.f!==undefined?` @[f${e.f}s${e.s}c${e.c}]`:'' )).join(' | ')}`);
          }
        } else {
          const tail = arr.slice(Math.max(0, arr.length - 48));
          // eslint-disable-next-line no-console
          console.error(`[4-scanline DEBUG] MMC3 trace (last ${tail.length}): ${tail.map((e: any) => e.type + (e.ctr!==undefined?`(ctr=${e.ctr}${e.en!==undefined?`,en=${e.en}`:''})`:'' ) + (e.v!==undefined?` v=${e.v}`:'' ) + (e.a!==undefined?` a=${e.a}`:'' ) + (e.f!==undefined?` @[f${e.f}s${e.s}c${e.c}]`:'' )).join(' | ')}`);
        }
      }
    }
    expect(res.status, `ROM reported: ${res.message}`).toBe(0);
  });
});

