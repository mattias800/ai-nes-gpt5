import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NESSystem } from '@core/system/system';
import { parseINes } from '@core/cart/ines';
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

function findScript(): string | null {
  const p = path.join(process.cwd(), 'tests', 'resources', 'smb3.input.json');
  return fs.existsSync(p) ? p : null;
}

function loadBaselines(): any {
  const p = path.join(process.cwd(), 'tests', 'resources', 'smb3_input.baselines.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8') || '{}'); } catch { return {}; }
}
function writeBaselines(b: any) {
  const p = path.join(process.cwd(), 'tests', 'resources', 'smb3_input.baselines.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(b, null, 2) + '\n');
}

// Format of input script JSON:
// {
//   "frames": 600,
//   "steps": [ { "frame": 0, "buttons": ["Start"] }, { "frame": 120, "buttons": ["Right","A"] } ... ]
// }
function parseScript(p: string): { frames: number, steps: { frame: number, buttons: string[] }[] } {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const frames = Number(raw.frames || 300);
  const steps = Array.isArray(raw.steps) ? raw.steps.map((s: any) => ({ frame: Number(s.frame||0), buttons: Array.isArray(s.buttons)? s.buttons as string[]: [] })) : [];
  return { frames, steps };
}

function setButtons(io: NESSystem['io'], names: string[], down: boolean) {
  const pad: any = io.getController(1);
  const all = ["A","B","Select","Start","Up","Down","Left","Right"];
  const set = new Set(names);
  for (const b of all) pad.setButton(b, set.has(b) ? down : false);
}

// Optional input-driven deterministic CRC for SMB3. Skipped if no ROM or script present.
describe.skipIf(!findLocalSMB3() || !findScript())('SMB3 input-script framebuffer CRC (optional)', () => {
  it('replays input script and checks/records baseline', { timeout: vitestTimeout('HARNESS_WALL_TIMEOUT_MS', 600000) }, () => {
    const romPath = findLocalSMB3()!;
    const scriptPath = findScript()!;
    const { frames, steps } = parseScript(scriptPath);

    const rom = parseINes(new Uint8Array(fs.readFileSync(romPath)));
    const sys = new NESSystem(rom);
    sys.reset();

    // Enable bg+sprites and left masks
    sys.io.write(0x2001, 0x1E);

    let stepIdx = 0;
    const start = sys.ppu.frame;
    const target = start + frames;
    let stepsCount = 0;
    const hardCap = frames * 600000; // generous cap
    const wallDeadline = mkWallDeadline('HARNESS_WALL_TIMEOUT_MS', 600000);

    while (sys.ppu.frame < target && stepsCount < hardCap) {
      // Apply button changes at frame start
      if (sys.ppu.cycle === 0) {
        while (stepIdx < steps.length && steps[stepIdx].frame <= (sys.ppu.frame - start)) {
          setButtons(sys.io, steps[stepIdx].buttons, true);
          // Strobe latch
          sys.io.write(0x4016, 1); sys.io.write(0x4016, 0);
          stepIdx++;
        }
      }
      sys.stepInstruction();
      stepsCount++;
      if (hitWall(wallDeadline)) break;
    }

    if (sys.ppu.frame < target) throw new Error('SMB3 input-script run timed out (wall or steps cap)');

    const fb: Uint8Array = (sys.ppu as any).getFrameBuffer();
    const hashHex = (crc32(fb) >>> 0).toString(16).padStart(8, '0');

    const store = loadBaselines();
    const romKey = (crc32(new Uint8Array(fs.readFileSync(romPath))) >>> 0).toString(16).padStart(8,'0');
    store[romKey] ||= {};
    if (process.env.SMB3_RECORD_INPUT_BASELINE === '1') {
      store[romKey].input = { frames, framebufferCrcHex: hashHex };
      writeBaselines(store);
      // eslint-disable-next-line no-console
      console.log(`Recorded SMB3 input baseline for ROM ${romKey}: frames=${frames}, crc=${hashHex}`);
      return;
    }
    if (store[romKey]?.input) {
      expect(frames).toBe(store[romKey].input.frames);
      expect(hashHex).toBe(store[romKey].input.framebufferCrcHex);
    } else {
      // eslint-disable-next-line no-console
      console.log(`SMB3 input framebuffer CRC32: 0x${hashHex.toUpperCase()} (${parseInt(hashHex,16)})`);
      expect(typeof hashHex).toBe('string');
    }
  });
});

