import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NESSystem } from '@core/system/system';
import { parseINes } from '@core/cart/ines';

(function loadDotEnv(){
  try {
    const p = path.resolve('.env');
    if (fs.existsSync(p)) {
      const t = fs.readFileSync(p, 'utf-8');
      for (const raw of t.split(/\r?\n/)) {
        const line = raw.trim(); if (!line || line.startsWith('#')) continue;
        const i = line.indexOf('='); if (i <= 0) continue;
        const k = line.slice(0, i).trim(); let v = line.slice(i+1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith('\'') && v.endsWith('\''))) v = v.slice(1, -1);
        if (!(k in process.env)) process.env[k] = v;
      }
    }
  } catch {}
})();

function findLocalSMB3(): string | null {
  const env = process.env.SMB3_ROM || process.env.SMB_ROM;
  if (env && fs.existsSync(env)) return env;
  const cwd = process.cwd();
  const files = fs.readdirSync(cwd).filter((f) => f.toLowerCase().endsWith('.nes'));
  if (files.length === 0) return null;
  files.sort((a, b) => {
    const ra = rank(a.toLowerCase());
    const rb = rank(b.toLowerCase());
    return ra - rb;
  });
  return path.join(cwd, files[0]);
  function rank(n: string): number {
    if (n.includes('mario3') || n.includes('smb3')) return 0;
    if (n.startsWith('mario')) return 1;
    return 2;
  }
}

// Auto-capture helpers
function dumpOnFailure(sys: NESSystem, tag: string, ring: string[]) {
  try {
    const mapper: any = (sys.cart as any).mapper;
    const mmTrace = (mapper && typeof mapper.getTrace === 'function') ? mapper.getTrace() : [];
    const a12Trace = (sys.ppu as any).getA12Trace ? (sys.ppu as any).getA12Trace() : [];
    // eslint-disable-next-line no-console
    console.error(`[SMB3-VERIFY FAIL:${tag}] frame=${sys.ppu.frame} cycle=${sys.ppu.cycle} scan=${sys.ppu.scanline}`);
    // eslint-disable-next-line no-console
    console.error('CPU tail:\n' + ring.slice(-100).join('\n'));
    // eslint-disable-next-line no-console
    console.error('MMC3 trace (head 100): ' + JSON.stringify(mmTrace.slice(0,100)));
    // eslint-disable-next-line no-console
    console.error('A12 rises (head 50): ' + JSON.stringify(a12Trace.slice(0,50)));
  } catch {}
}

// This verifier focuses on accuracy invariants rather than CRCs or snapshots.
// It validates that SMB3 boots on MMC3, services NMI once rendering is enabled, causes A12 rises,
// and performs basic MMC3 register writes within a reasonable timeframe.

describe.skipIf(!findLocalSMB3())('SMB3 boot verifier (accuracy invariants)', () => {
  it('mapper=MMC3; NMI serviced; MMC3 writes observed; A12 rises present', () => {
    const romPath = findLocalSMB3()!;
    const rom = parseINes(new Uint8Array(fs.readFileSync(romPath)));

    // Expect MMC3 (mapper 4)
    expect(rom.mapper).toBe(4);

    // Enable traces for richer failure dumps
    process.env.PPU_TRACE = '1';
    process.env.MMC3_TRACE = '1';

    const sys = new NESSystem(rom);
    sys.reset();

    // Enable background+sprites; left masks on (consistent behavior)
    sys.io.write(0x2001, 0x1E);

    // Capture CPU tail trace in-memory
    const ring: string[] = [];
    (sys.cpu as any).setTraceHook((pc: number, op: number) => {
      if (ring.length > 5000) ring.shift();
      ring.push(`PC=$${pc.toString(16).padStart(4,'0')} OP=$${op.toString(16).padStart(2,'0')}`);
    });

    // Compute NMI vector for detection
    const nmiVec = sys.bus.read(0xFFFA) | (sys.bus.read(0xFFFB) << 8);

    let nmiServiced = 0;
    let mmc3Writes = 0;
    const mapper: any = (sys.cart as any).mapper;
    // Track how much of the MMC3 trace we've already processed to avoid O(N^2) rescans
    let prevTraceLen = 0;

    // Run up to N frames, checking invariants as we go
    const targetFrames = Number(process.env.SMB3_VERIFY_FRAMES || 300);
    const start = sys.ppu.frame;
    const target = start + targetFrames;
    let steps = 0;
    const hardCap = targetFrames * 1_000_000; // generous

    try {
      while (sys.ppu.frame < target && steps < hardCap) {
        sys.stepInstruction();
        steps++;
        // Track NMI service: if current PC equals the NMI vector
        if (sys.cpu.state.pc === nmiVec) nmiServiced++;
        // Track MMC3 writes seen so far (process only new trace entries)
        if (mapper && typeof mapper.getTrace === 'function') {
          const t = mapper.getTrace();
          if (t.length > prevTraceLen) {
            for (let i = prevTraceLen; i < t.length; i++) {
              const typ = t[i]?.type;
              if (typ === '8000' || typ === '8001' || typ === 'C000' || typ === 'C001' || typ === 'E000' || typ === 'E001') {
                mmc3Writes++;
              }
            }
            prevTraceLen = t.length;
          }
        }
      }
      if (steps >= hardCap) throw new Error('Verifier timed out');
    } catch (e) {
      dumpOnFailure(sys, 'runtime', ring);
      throw e;
    }

    // A12 rises observed?
    const a12 = (sys.ppu as any).getA12Trace ? (sys.ppu as any).getA12Trace() : [];

    // Invariants (heuristic but accuracy-oriented):
    // - At least one NMI serviced across the run
    // - At least some MMC3 register writes happened by then
    // - A12 rises observed (should be many if rendering)
    try {
      expect(nmiServiced).toBeGreaterThan(0);
      expect(mmc3Writes).toBeGreaterThan(0);
      expect(a12.length).toBeGreaterThan(0);
    } catch (e) {
      dumpOnFailure(sys, 'invariants', ring);
      throw e;
    }
  });
});

