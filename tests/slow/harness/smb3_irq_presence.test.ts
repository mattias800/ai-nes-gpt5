import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NESSystem } from '@core/system/system';
import { parseINes } from '@core/cart/ines';
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
    if (n.includes('mario3') || n.includes('smb3')) return 0;
    if (n.startsWith('mario')) return 1;
    return 2;
  }
}

// Optional, ROM-gated test: verify SMB3 triggers MMC3 IRQ at least once under rendering
// Focused on invariant presence, not exact counts.
describe.skipIf(!findLocalSMB3())('SMB3 IRQ presence invariant (optional)', () => {
  it('observes MMC3 writes, A12 rises, and at least one IRQ service', { timeout: vitestTimeout('HARNESS_WALL_TIMEOUT_MS', 600000) }, () => {
    const romPath = findLocalSMB3()!;
    const rom = parseINes(new Uint8Array(fs.readFileSync(romPath)));

    // mapper must be MMC3 (4)
    expect(rom.mapper).toBe(4);

    process.env.PPU_TRACE = '1';
    process.env.MMC3_TRACE = '1';

    const sys = new NESSystem(rom);
    sys.reset();
    // Enable rendering (bg+sprites, left masks on)
    sys.io.write(0x2001, 0x1E);

    // IRQ vector address
    const irqVec = sys.bus.read(0xFFFE) | (sys.bus.read(0xFFFF) << 8);

    const mapper: any = (sys.cart as any).mapper;

    let irqServiced = 0;
    let mmc3Writes = 0;
    let prevTraceLen = 0;

    const frames = Number(process.env.SMB3_IRQ_FRAMES || 400);
    const startF = sys.ppu.frame;
    const target = startF + frames;
    const hardCap = frames * 1_000_000;
    let steps = 0;
    const wallDeadline = mkWallDeadline('HARNESS_WALL_TIMEOUT_MS', 600000);

    const ring: string[] = [];
    (sys.cpu as any).setTraceHook((pc: number, op: number) => {
      if (ring.length > 8000) ring.shift();
      ring.push(`PC=$${pc.toString(16).padStart(4,'0')} OP=$${op.toString(16).padStart(2,'0')}`);
    });

    try {
      while (sys.ppu.frame < target && steps < hardCap) {
        sys.stepInstruction();
        steps++;
        if (hitWall(wallDeadline)) break;
        if (sys.cpu.state.pc === irqVec) irqServiced++;
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
      if (sys.ppu.frame < target) throw new Error('SMB3 IRQ presence run timed out (wall or steps cap)');
    } catch (e) {
      try {
        const fb: Uint8Array = (sys.ppu as any).getFrameBuffer();
        const { crc32 } = require('@utils/crc32');
        const fbCrc = (crc32(fb) >>> 0).toString(16).padStart(8,'0');
        // eslint-disable-next-line no-console
        console.error(`[SMB3-IRQ FAIL] frame=${sys.ppu.frame} scan=${sys.ppu.scanline} cyc=${sys.ppu.cycle} fbCRC=0x${fbCrc}`);
        // eslint-disable-next-line no-console
        console.error('CPU Trace tail:\n' + ring.slice(-120).join('\n'));
      } catch {}
      throw e;
    }

    const a12 = (sys.ppu as any).getA12Trace ? (sys.ppu as any).getA12Trace() : [];

    expect(mmc3Writes).toBeGreaterThan(0);
    expect(a12.length).toBeGreaterThan(0);
    expect(irqServiced).toBeGreaterThan(0);
  });
});

