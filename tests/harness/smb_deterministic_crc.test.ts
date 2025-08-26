import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseINes } from '@core/cart/ines';
import { NESSystem } from '@core/system/system';
import { crc32 } from '@utils/crc32';
import { crcHexOfSample } from './helpers/state_crc';

function findMarioRom(): string | null {
  const env = process.env.SMB_ROM;
  if (env && fs.existsSync(env)) return env;
  const roots = [process.cwd(), path.join(process.cwd(), 'roms')];
  const candidates: string[] = [];
  for (const dir of roots) {
    try {
      const names = fs.readdirSync(dir);
      for (const n of names) if (/^mario.*\.nes$/i.test(n)) candidates.push(path.join(dir, n));
    } catch {}
  }
  return candidates.length ? candidates.sort()[0] : null;
}

function crcHexOfFile(buf: Buffer): string {
  const c = crc32(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  return (c >>> 0).toString(16).padStart(8, '0');
}

function runOneFrame(sys: NESSystem, hardCap = 5_000_000) {
  const target = sys.ppu.frame + 1;
  let steps = 0;
  while (sys.ppu.frame < target && steps < hardCap) { sys.stepInstruction(); steps++; }
  if (steps >= hardCap) throw new Error('runOneFrame timed out');
}

function loadBaselines() {
  const p = path.join(process.cwd(), 'tests', 'resources', 'smb.baselines.json');
  if (!fs.existsSync(p)) return {} as Record<string, { frames: number, stateCrcHex: string }>;
  try { return JSON.parse(fs.readFileSync(p, 'utf8') || '{}'); } catch { return {}; }
}

function writeBaselines(b: Record<string, { frames: number, stateCrcHex: string }>) {
  const p = path.join(process.cwd(), 'tests', 'resources', 'smb.baselines.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(b, null, 2) + '\n');
}

describe('[@smb-baseline] SMB deterministic CRC (boot)', () => {
  it('runs N frames and matches/records baseline', () => {
    const romPath = findMarioRom();
    if (!romPath) { console.warn('SMB ROM not found. Place mario*.nes in repo root or ./roms or set SMB_ROM.'); return; }
    const romBuf = fs.readFileSync(romPath);
    const romCrc = crcHexOfFile(romBuf);

    const rom = parseINes(new Uint8Array(romBuf));
    const sys = new NESSystem(rom);
    sys.reset();
    // Minimal rendering enable; ensures A12 pulses for MMC3 timing if needed
    sys.io.write(0x2001, 0x1E);

    const baselines = loadBaselines();
    const frames = Number(process.env.SMB_FRAMES || (baselines[romCrc]?.frames ?? 60));
    for (let i = 0; i < frames; i++) runOneFrame(sys);

    const stateCrc = crcHexOfSample(sys);

    if (process.env.SMB_RECORD_BASELINE === '1') {
      baselines[romCrc] = { frames, stateCrcHex: stateCrc };
      writeBaselines(baselines);
      // eslint-disable-next-line no-console
      console.log(`Recorded SMB baseline for ROM ${romCrc}: frames=${frames}, crc=${stateCrc}`);
      return;
    }

    if (!baselines[romCrc]) {
      console.warn(`SMB baseline missing for ROM CRC ${romCrc}. Record with: npm run baseline:smb`);
      return;
    }

    expect(frames).toBe(baselines[romCrc].frames);
    expect(stateCrc).toBe(baselines[romCrc].stateCrcHex);
  });
});

