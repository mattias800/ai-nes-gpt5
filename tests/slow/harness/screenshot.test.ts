import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NESSystem } from '@core/system/system';
import { parseINes } from '@core/cart/ines';
import { PNG } from 'pngjs';

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

function findLocalRom(): string | null {
  // Priority: env override > roms/ directory > repo root
  const envRom = process.env.SCREENSHOT_ROM || process.env.SMB3_ROM || process.env.SMB_ROM
  if (envRom && fs.existsSync(envRom)) return envRom
  const roots = [process.cwd(), path.join(process.cwd(), 'roms')]
  const candidates: string[] = []
  for (const dir of roots) {
    try {
      const names = fs.readdirSync(dir)
      for (const n of names) if (n.toLowerCase().endsWith('.nes')) candidates.push(path.join(dir, n))
    } catch {}
  }
  // Prefer SMB3-style names first, then SMB1-style
  candidates.sort((a, b) => {
    const A = path.basename(a).toLowerCase()
    const B = path.basename(b).toLowerCase()
    const rank = (s: string): number => (
      /^smb3|^mario3/.test(s) ? 0 : (/^mario/.test(s) ? 1 : 2)
    )
    const ra = rank(A), rb = rank(B)
    if (ra !== rb) return ra - rb
    return A.localeCompare(B)
  })
  return candidates[0] || null
}

function nesPaletteToRGB(idx: number): [number, number, number] {
  // Simple NTSC NES palette approximation (subset). For testing/screenshot we can use a compact table.
  // This is a minimal mapping; you can replace with a more accurate palette later.
  const PALETTE: [number, number, number][] = [
    [84,84,84],[0,30,116],[8,16,144],[48,0,136],[68,0,100],[92,0,48],[84,4,0],[60,24,0],
    [32,42,0],[8,58,0],[0,64,0],[0,60,0],[0,50,60],[0,0,0],[0,0,0],[0,0,0],
    [152,150,152],[8,76,196],[48,50,236],[92,30,228],[136,20,176],[160,20,100],[152,34,32],[120,60,0],
    [84,90,0],[40,114,0],[8,124,0],[0,118,40],[0,102,120],[0,0,0],[0,0,0],[0,0,0],
    [236,238,236],[76,154,236],[120,124,236],[176,98,236],[228,84,236],[236,88,180],[236,106,100],[212,136,32],
    [160,170,0],[116,196,0],[76,208,32],[56,204,108],[56,180,204],[60,60,60],[0,0,0],[0,0,0],
    [236,238,236],[168,204,236],[188,188,236],[212,178,236],[236,174,236],[236,174,212],[236,180,176],[228,196,144],
    [204,210,120],[180,222,120],[168,226,144],[152,226,180],[160,214,228],[160,162,160],[0,0,0],[0,0,0],
  ];
  return PALETTE[(idx & 0x3F) % PALETTE.length];
}

async function writePngScaled(pathOut: string, fb: Uint8Array, w = 256, h = 240, scale = 1) {
  const W = w * Math.max(1, scale|0), H = h * Math.max(1, scale|0)
  const png = new PNG({ width: W, height: H });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const [r,g,b] = nesPaletteToRGB(fb[i] & 0x3F);
      // Nearest-neighbor scale
      for (let dy = 0; dy < scale; dy++) {
        const oy = (y*scale + dy) * W
        for (let dx = 0; dx < scale; dx++) {
          const o = ((oy + (x*scale + dx)) << 2)
          png.data[o+0] = r
          png.data[o+1] = g
          png.data[o+2] = b
          png.data[o+3] = 255
        }
      }
    }
  }
  const dir = path.dirname(pathOut);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const stream = fs.createWriteStream(pathOut);
  await new Promise<void>((resolve, reject) => {
    stream.on('finish', () => resolve());
    stream.on('error', (e) => reject(e));
    png.pack().pipe(stream);
  });
}

describe.skipIf(!findLocalRom())('Screenshot harness (optional)', () => {
  it('renders background-only and full-frame PNGs after N frames', { timeout: Number.parseInt(process.env.HARNESS_WALL_TIMEOUT_MS || '180000', 10) }, async () => {
    const romPath = findLocalRom()!;
    const rom = parseINes(new Uint8Array(fs.readFileSync(romPath)));
    const sys = new NESSystem(rom);

    // Force timing/region suitable for SMB3 raster splits by default
    const timing = (process.env.SCREENSHOT_TIMING || 'vt').toLowerCase() === 'legacy' ? 'legacy' : 'vt'
    ;(sys.ppu as unknown as { setTimingMode?: (m: 'vt'|'legacy') => void }).setTimingMode?.(timing)
    const region = ((process.env.SCREENSHOT_REGION || 'NTSC').toUpperCase() === 'PAL' ? 'PAL' : 'NTSC') as 'NTSC'|'PAL'
    ;(sys.apu as unknown as { setRegion?: (r: 'NTSC'|'PAL') => void }).setRegion?.(region)

    sys.reset();

    // Enable background + sprites for full frame; and BG for bg-only shot
    sys.io.write(0x2001, 0x1E);

    // Run some frames to reach a stable screen
    const defaultFrames = /smb3|mario3/i.test(romPath) ? 360 : 60
    const absFrameStr = process.env.SCREENSHOT_FRAME_ABS
    const absTarget = absFrameStr ? Math.max(0, parseInt(absFrameStr, 10)) : null

    const frames = parseInt(process.env.SCREENSHOT_FRAMES || String(defaultFrames), 10);
    const start = sys.ppu.frame;
    const wallMs = Number.parseInt(process.env.HARNESS_WALL_TIMEOUT_MS || '180000', 10);
    let wallDeadline = Date.now() + wallMs;

    if (absTarget != null) {
      // Advance to absolute PPU frame number
      while (sys.ppu.frame < absTarget) {
        sys.stepInstruction();
        if (Date.now() >= wallDeadline) break;
      }
      if (sys.ppu.frame < absTarget) throw new Error('Screenshot run timed out (wall)');
    } else {
      // Advance relative frames, then optional extra delay
      while (sys.ppu.frame < start + frames) {
        sys.stepInstruction();
        if (Date.now() >= wallDeadline) break;
      }
      if (sys.ppu.frame < start + frames) throw new Error('Screenshot run timed out (wall)');

      // Wait additional hardware seconds (default 5s @ 60 FPS) before capture for stability
      const fps = Math.max(1, parseInt(process.env.SCREENSHOT_FPS || '60', 10));
      const extraSecs = Math.max(0, parseInt(process.env.SCREENSHOT_EXTRA_SECS || '5', 10));
      const extraFrames = fps * extraSecs;
      const delayStart = sys.ppu.frame;
      wallDeadline = Date.now() + wallMs;
      while (sys.ppu.frame < delayStart + extraFrames) {
        sys.stepInstruction();
        if (Date.now() >= wallDeadline) break;
      }
    }

    const scale = Math.max(1, parseInt(process.env.SCREENSHOT_SCALE || '2', 10))

    // Capture the PPU's last completed full frame (same buffer used by browser host)
    const fb = (sys.ppu as any).getFrameBuffer() as Uint8Array
    const fullOut = /smb3|mario3/i.test(romPath) ? `screenshots/smb3_title_${scale}x.png` : `screenshots/mario_full_${scale}x.png`
    await writePngScaled(fullOut, fb, 256, 240, scale)

    expect(fs.existsSync(fullOut)).toBe(true);
  });
});

