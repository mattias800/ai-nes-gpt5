import { crc32 } from '@utils/crc32';
import type { NESSystem } from '@core/system/system';

// Build a compact, deterministic sample of emulator state for CRC baselines.
// Includes:
// - 32-byte palette (masked to 6-bit values)
// - 512 bytes sampled from CIRAM/nametable RAM (2KB) using a stride to cover space
// - 512 bytes sampled from CHR space (0x0000 and 0x1000 regions)
export function collectStateSample(sys: NESSystem): Uint8Array {
  const ppu: any = sys.ppu as any;
  const cartAny: any = sys.cart as any;
  const mapperAny: any = (sys.cart as any).mapper as any;

  // Palette (32 bytes, 6-bit masked)
  const palSrc: Uint8Array = ppu['palette'] as Uint8Array;
  const pal = new Uint8Array(32);
  for (let i = 0; i < 32; i++) pal[i] = (palSrc[i] ?? 0) & 0x3F;

  // Nametable sample: 512 bytes from 2KB VRAM using a coprime stride
  const vram: Uint8Array = ppu['vram'] as Uint8Array; // 0x800 bytes
  const nts = new Uint8Array(512);
  let idx = 0;
  for (let i = 0; i < nts.length; i++) {
    idx = (idx + 17) & 0x7FF; // 17 is coprime with 2048
    nts[i] = vram[idx] & 0xFF;
  }

  // CHR sample: 256 bytes from $0000 region and 256 bytes from $1000 region using different strides
  const chr = new Uint8Array(512);
  const readChr = (addr: number) => (cartAny.readChr ? cartAny.readChr(addr & 0x1FFF) : 0) & 0xFF;
  let a = 0;
  for (let i = 0; i < 256; i++) { a = (a + 13) & 0x0FFF; chr[i] = readChr(a); }
  a = 0x1000;
  for (let i = 0; i < 256; i++) { a = 0x1000 | (((a + 29) & 0x0FFF)); chr[256 + i] = readChr(a); }

  // PRG-RAM sample: first 256 bytes at $6000
  const prgRam = new Uint8Array(256);
  for (let i = 0; i < 256; i++) prgRam[i] = (sys.cart.readCpu(0x6000 + i) & 0xFF);

  // MMC3 snapshot (if present): bankSelect, bankRegs[0..7], irqLatch, irqCounter, irqEnabled
  const mm = new Uint8Array(1 + 8 + 3);
  try {
    const bs = (mapperAny && typeof mapperAny === 'object' && 'getTrace' in mapperAny) ? mapperAny : null;
    // Access internal via best-effort: these are private; using any reflection for tests
    const bankSelect = (mapperAny && mapperAny['bankSelect']) & 0xFF || 0;
    mm[0] = bankSelect;
    for (let i = 0; i < 8; i++) mm[1 + i] = (mapperAny && mapperAny['bankRegs'] ? mapperAny['bankRegs'][i] & 0xFF : 0);
    mm[9] = (mapperAny && mapperAny['irqLatch']) & 0xFF || 0;
    mm[10] = (mapperAny && mapperAny['irqCounter']) & 0xFF || 0;
    mm[11] = (mapperAny && mapperAny['irqEnabled']) ? 1 : 0;
  } catch { /* ignore */ }

  const out = new Uint8Array(pal.length + nts.length + chr.length + prgRam.length + mm.length);
  let off = 0;
  out.set(pal, off); off += pal.length;
  out.set(nts, off); off += nts.length;
  out.set(chr, off); off += chr.length;
  out.set(prgRam, off); off += prgRam.length;
  out.set(mm, off); off += mm.length;
  return out;
}

export function crcHexOfSample(sys: NESSystem): string {
  const buf = collectStateSample(sys);
  const c = crc32(buf) >>> 0;
  return c.toString(16).padStart(8, '0');
}

