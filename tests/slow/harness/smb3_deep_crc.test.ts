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

function loadBaselines(): any {
  const p = path.join(process.cwd(), 'tests', 'resources', 'smb3.baselines.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8') || '{}'); } catch { return {}; }
}
function writeBaselines(b: any) {
  const p = path.join(process.cwd(), 'tests', 'resources', 'smb3.baselines.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(b, null, 2) + '\n');
}

// Optional deep run (~600 frames) for SMB3 determinism; skipped if no ROM present.
describe.skipIf(!findLocalSMB3())('SMB3 deep framebuffer CRC (optional)', () => {
  it('runs ~600 frames and checks baseline store', { timeout: vitestTimeout('HARNESS_WALL_TIMEOUT_MS', 600000) }, () => {
    const romPath = findLocalSMB3()!;
    const rom = parseINes(new Uint8Array(fs.readFileSync(romPath)));
    const sys = new NESSystem(rom);
    sys.reset();

    // Enable bg+sprites with left masks visible for consistent CRC
    sys.io.write(0x2001, 0x1E);

    const frames = Number(process.env.SMB3_DEEP_FRAMES || 600);
    const start = sys.ppu.frame;
    const target = start + frames;
    let steps = 0;
    const hardCap = 200_000_000; // generous
    const wallDeadline = mkWallDeadline('HARNESS_WALL_TIMEOUT_MS', 600000);
    while (sys.ppu.frame < target && steps < hardCap) {
      sys.stepInstruction(); steps++;
      if (hitWall(wallDeadline)) break;
    }
    if (sys.ppu.frame < target) throw new Error('SMB3 deep CRC run timed out (wall or steps cap)');

    const fb = (sys.ppu as any).getFrameBuffer() as Uint8Array;
    const hashHex = (crc32(fb) >>> 0).toString(16).padStart(8,'0');

    const store = loadBaselines();
    const romKey = (crc32(new Uint8Array(fs.readFileSync(romPath))) >>> 0).toString(16).padStart(8,'0');
    store[romKey] ||= {};
    if (process.env.SMB3_RECORD_BASELINE === '1') {
      store[romKey].deep = { frames, framebufferCrcHex: hashHex };
      writeBaselines(store);
      // eslint-disable-next-line no-console
      console.log(`Recorded SMB3 deep baseline for ROM ${romKey}: frames=${frames}, crc=${hashHex}`);
      return;
    }
    if (store[romKey]?.deep) {
      expect(frames).toBe(store[romKey].deep.frames);
      expect(hashHex).toBe(store[romKey].deep.framebufferCrcHex);
    } else {
      // eslint-disable-next-line no-console
      console.log(`SMB3 deep framebuffer CRC32: 0x${hashHex.toUpperCase()} (${parseInt(hashHex,16)})`);
      expect(typeof hashHex).toBe('string');
    }
  });
});

