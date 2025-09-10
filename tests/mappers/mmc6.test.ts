import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { INesRom } from '@core/cart/ines';
import { NESSystem } from '@core/system/system';

const makeRom = (prgKB: number): INesRom => {
  const prg = new Uint8Array(prgKB * 1024);
  // Fill first bytes to identify banks
  if (prg.length >= 0x8000) {
    prg.fill(0xA0, 0x0000, 0x4000);
    prg.fill(0xB0, 0x4000, 0x8000);
  } else {
    prg.fill(0xC0);
  }
  const chr = new Uint8Array(0); // CHR RAM
  return { prg, chr, mapper: 4, hasTrainer: false, prgRamSize: 8 * 1024, flags6: 0, flags7: 0 };
};

describe('MMC6 (mapper 4 variant) 1KB WRAM', () => {
  const old = process.env.FORCE_MMC6;
  beforeEach(() => { process.env.FORCE_MMC6 = '1'; });
  afterEach(() => { if (old === undefined) delete process.env.FORCE_MMC6; else process.env.FORCE_MMC6 = old; });

  it('WRAM disabled by default; enabling via $A001 allows reads/writes; 1KB mirroring across $6000-$7FFF; write-protect honored', () => {
    const rom = makeRom(32); // 32KB PRG (single 32K bank, enough for MMC3 to operate)
    const sys = new NESSystem(rom);

    // Default disabled: reads return 0, writes ignored
    sys.cart.writeCpu(0x6000, 0x11);
    expect(sys.cart.readCpu(0x6000) & 0xFF).toBe(0x00);

    // Enable WRAM (bit7)
    sys.cart.writeCpu(0xA001, 0x80);

    // Write and verify mirroring: offsets wrap every 1KB
    sys.cart.writeCpu(0x6000, 0x11);
    expect(sys.cart.readCpu(0x6000) & 0xFF).toBe(0x11);

    // Use two distinct offsets within 1KB window
    sys.cart.writeCpu(0x63FF, 0x22);
    expect(sys.cart.readCpu(0x63FF) & 0xFF).toBe(0x22);
    // Mirror check: 0x67FF shares the same 1KB offset as 0x63FF
    expect(sys.cart.readCpu(0x67FF) & 0xFF).toBe(0x22);
    // Ensure base offset remains unchanged
    expect(sys.cart.readCpu(0x6000) & 0xFF).toBe(0x11);

    // Write-protect (bit6) prevents writes
    sys.cart.writeCpu(0xA001, 0xC0);
    sys.cart.writeCpu(0x6000, 0x33);
    expect(sys.cart.readCpu(0x6000) & 0xFF).toBe(0x11);

    // Disable WRAM -> reads as 0
    sys.cart.writeCpu(0xA001, 0x00);
    expect(sys.cart.readCpu(0x6000) & 0xFF).toBe(0x00);
  });
});
