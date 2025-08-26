import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseINes } from '@core/cart/ines';
import { NESSystem } from '@core/system/system';
import { crcHexOfSample } from '../../harness/helpers/state_crc';
import { crc32 } from '@utils/crc32';

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
  const p = path.join(process.cwd(), 'tests', 'resources', 'smb3_state.baselines.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8') || '{}'); } catch { return {}; }
}
function writeBaselines(b: any) {
  const p = path.join(process.cwd(), 'tests', 'resources', 'smb3_state.baselines.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(b, null, 2) + '\n');
}

// Deterministic state CRC for SMB3 (optional); skipped if no ROM.
describe.skipIf(!findLocalSMB3())('SMB3 state deterministic CRC (optional)', () => {
  it('runs N frames and checks or records state CRC baseline', () => {
    const romPath = findLocalSMB3()!;
    const rom = parseINes(new Uint8Array(fs.readFileSync(romPath)));
    const sys = new NESSystem(rom);
    sys.reset();

    // Enable bg+sprites with left masks visible for consistency
    sys.io.write(0x2001, 0x1E);

    const frames = Number(process.env.SMB3_STATE_FRAMES || 60);
    const start = sys.ppu.frame;
    const target = start + frames;
    let steps = 0;
    const hardCap = 100_000_000;
    while (sys.ppu.frame < target && steps < hardCap) { sys.stepInstruction(); steps++; }
    if (steps >= hardCap) throw new Error('SMB3 state CRC run timed out');

    const sampleHex = crcHexOfSample(sys);

    const store = loadBaselines();
    const romKey = (crc32(new Uint8Array(fs.readFileSync(romPath))) >>> 0).toString(16).padStart(8,'0');
    store[romKey] ||= {};
    if (process.env.SMB3_RECORD_STATE_BASELINE === '1') {
      store[romKey].state = { frames, sampleCrcHex: sampleHex };
      writeBaselines(store);
      // eslint-disable-next-line no-console
      console.log(`Recorded SMB3 state baseline for ROM ${romKey}: frames=${frames}, crc=${sampleHex}`);
      return;
    }
    if (store[romKey]?.state) {
      expect(frames).toBe(store[romKey].state.frames);
      expect(sampleHex).toBe(store[romKey].state.sampleCrcHex);
    } else {
      // eslint-disable-next-line no-console
      console.log(`SMB3 state sample CRC32: 0x${sampleHex.toUpperCase()} (${parseInt(sampleHex,16)})`);
      expect(typeof sampleHex).toBe('string');
    }
  });
});

