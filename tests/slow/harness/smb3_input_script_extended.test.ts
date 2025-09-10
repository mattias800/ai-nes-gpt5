import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseINes } from '@core/cart/ines';
import { NESSystem } from '@core/system/system';
import { crc32 } from '@utils/crc32';
import { mkWallDeadline, hitWall, vitestTimeout } from '../../helpers/walltime';

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
    if (n.startsWith('smb3') || n.includes('mario3')) return 0;
    if (n.startsWith('mario')) return 1;
    return 2;
  }
}

function scriptPath(): string { return path.join(process.cwd(), 'tests', 'smb3', 'input_script_extended.json'); }

function loadBaselines(): any {
  const p = path.join(process.cwd(), 'tests', 'resources', 'smb3_input_extended.baselines.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8') || '{}'); } catch { return {}; }
}
function writeBaselines(b: any) {
  const p = path.join(process.cwd(), 'tests', 'resources', 'smb3_input_extended.baselines.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(b, null, 2) + '\n');
}

// Extended script format adds checkpoints for CRC capture at specific frames
function parseScript(p: string): { frames: number, steps: { frame: number, buttons: string[] }[], checkpoints: { frame: number, tag: string }[] } {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const frames = Number(raw.frames || 1800);
  const steps = Array.isArray(raw.steps) ? raw.steps.map((s: any) => ({ frame: Number(s.frame||0), buttons: Array.isArray(s.buttons)? s.buttons as string[]: [] })) : [];
  const checkpoints = Array.isArray(raw.checkpoints) ? raw.checkpoints.map((c: any) => ({ frame: Number(c.frame||0), tag: String(c.tag||'') })) : [];
  return { frames, steps, checkpoints };
}

function setButtons(io: NESSystem['io'], names: string[], down: boolean) {
  const pad: any = io.getController(1);
  const all = ["A","B","Select","Start","Up","Down","Left","Right"];
  const set = new Set(names);
  for (const b of all) pad.setButton(b, set.has(b) ? down : false);
}

// Capture helpers on failure
function onFailureDump(sys: NESSystem, tag: string) {
  try {
    const fb: Uint8Array = (sys.ppu as any).getFrameBuffer();
    const fbHex = (crc32(fb) >>> 0).toString(16).padStart(8, '0');
    const stateSampleCrc = (() => {
      try {
        const { crcHexOfSample } = require('../../harness/helpers/state_crc');
        return crcHexOfSample(sys);
      } catch { return 'n/a'; }
    })();

    // MMC3 trace if available
    let mmc3Trace: any = 'n/a';
    try {
      const mapper: any = (sys.cart as any).mapper;
      if (mapper && typeof mapper.getTrace === 'function') mmc3Trace = mapper.getTrace();
    } catch {}

    // PPU A12 trace (enable by env)
    let a12Trace: any = 'n/a';
    try { a12Trace = (sys.ppu as any).getA12Trace(); } catch {}

    // eslint-disable-next-line no-console
    console.error(`SMB3 fail [${tag}] fbCRC=0x${fbHex} stateCRC=0x${String(stateSampleCrc).toUpperCase()}\nA12Trace=${JSON.stringify(a12Trace).slice(0,2000)}\nMMC3Trace=${JSON.stringify(mmc3Trace).slice(0,2000)}`);
  } catch {}
}

// Optional extended input-driven multi-checkpoint CRCs for SMB3. Skipped if no ROM.
describe.skipIf(!findLocalSMB3())('SMB3 extended input-script CRC checkpoints (optional)', () => {
  it('replays extended script and checks/records per-checkpoint CRCs', { timeout: vitestTimeout('HARNESS_WALL_TIMEOUT_MS', 900000) }, () => {
    const romPath = findLocalSMB3()!;
    const sp = scriptPath();
    const { frames, steps, checkpoints } = parseScript(sp);

    // Enable extra traces for failure diagnostics
    process.env.PPU_TRACE = '1';
    process.env.MMC3_TRACE = '1';

    const rom = parseINes(new Uint8Array(fs.readFileSync(romPath)));
    const sys = new NESSystem(rom);
    sys.reset();

    // Enable bg+sprites and left masks for consistency
    sys.io.write(0x2001, 0x1E);

    // Attach CPU step trace ring (in-memory). We don't print unless we fail.
    const ring: string[] = [];
    (sys.cpu as any).setTraceHook((pc: number, op: number) => {
      if (ring.length > 10000) ring.shift();
      ring.push(`PC=$${pc.toString(16).padStart(4,'0')} OP=$${op.toString(16).padStart(2,'0')}`);
    });

    // Replay script and capture CRCs at checkpoints
    const start = sys.ppu.frame;
    const target = start + frames;
    const cps = new Map<number,string>(checkpoints.map(c => [c.frame, c.tag]));
    const captured: Record<string,string> = {};

    let stepIdx = 0;
    let stepsCount = 0;
    const hardCap = frames * 800000; // generous
    const wallDeadline = mkWallDeadline('HARNESS_WALL_TIMEOUT_MS', 900000);

    try {
      while (sys.ppu.frame < target && stepsCount < hardCap) {
        // Apply input events at frame start
        if (sys.ppu.cycle === 0) {
          const cur = sys.ppu.frame - start;
          while (stepIdx < steps.length && steps[stepIdx].frame <= cur) {
            setButtons(sys.io, steps[stepIdx].buttons, true);
            // Strobe
            sys.io.write(0x4016, 1); sys.io.write(0x4016, 0);
            stepIdx++;
          }
          // Capture checkpoints at frame start
          const tag = cps.get(cur);
          if (tag) {
            const fb: Uint8Array = (sys.ppu as any).getFrameBuffer();
            captured[tag] = (crc32(fb) >>> 0).toString(16).padStart(8, '0');
          }
        }
        sys.stepInstruction();
        stepsCount++;
        if (hitWall(wallDeadline)) break;
      }
      if (sys.ppu.frame < target) throw new Error('SMB3 extended input run timed out (wall or steps cap)');
    } catch (e) {
      onFailureDump(sys, 'runtime-error');
      // eslint-disable-next-line no-console
      console.error('CPU Trace (tail):\n' + ring.slice(-100).join('\n'));
      throw e;
    }

    // Compare with baselines if present
    const store = loadBaselines();
    const romKey = (crc32(new Uint8Array(fs.readFileSync(romPath))) >>> 0).toString(16).padStart(8,'0');
    store[romKey] ||= {};

    const wantRecord = process.env.SMB3_RECORD_INPUT_EXTENDED_BASELINE === '1';
    if (wantRecord) {
      store[romKey].extended = { frames, checkpoints: captured };
      writeBaselines(store);
      // eslint-disable-next-line no-console
      console.log(`Recorded SMB3 input-extended baseline for ROM ${romKey}: frames=${frames}, cps=${JSON.stringify(captured)}`);
      return;
    }

    const baseline = store[romKey]?.extended;
    if (baseline) {
      expect(frames).toBe(baseline.frames);
      for (const [tag, hash] of Object.entries(baseline.checkpoints || {})) {
        expect(captured[tag]).toBe(hash);
      }
    } else {
      // No baseline present: print out captured CRCs for manual seeding and accept
      // eslint-disable-next-line no-console
      console.log('SMB3 extended captured CRCs:', captured);
      expect(typeof captured).toBe('object');
    }
  });
});

