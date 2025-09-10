import { describe, it, expect } from 'vitest';
import type { INesRom } from '@core/cart/ines';
import { NESSystem } from '@core/system/system';

const makeRom = (prgBanks32k: number): INesRom => {
  const prg = new Uint8Array(prgBanks32k * 0x8000);
  for (let b = 0; b < prgBanks32k; b++) {
    const base = b * 0x8000;
    // Fill each bank with a distinct pattern; first byte distinguishes bank
    prg.fill(0xA0 + b, base, base + 0x8000);
    prg[base + 0] = 0xB0 + b;
  }
  const chr = new Uint8Array(0); // CHR RAM
  return { prg, chr, mapper: 7, hasTrainer: false, prgRamSize: 8 * 1024, flags6: 0, flags7: 0 };
};

const writePpuAddr = (sys: NESSystem, addr: number) => {
  sys.ppu.cpuWrite(0x2006, (addr >> 8) & 0xFF);
  sys.ppu.cpuWrite(0x2006, addr & 0xFF);
};

const writeVram = (sys: NESSystem, addr: number, value: number) => {
  writePpuAddr(sys, addr & 0x3FFF);
  sys.ppu.cpuWrite(0x2007, value & 0xFF);
};

describe('Mapper 7 (AxROM)', () => {
  it('banks 32KB PRG at $8000-$FFFF via writes to $8000', () => {
    const rom = makeRom(2); // 64KB PRG => 2 banks
    const sys = new NESSystem(rom);

    // Select bank 0
    sys.cart.writeCpu(0x8000, 0x00);
    const v0 = sys.cart.readCpu(0x8000);
    expect(v0 & 0xFF).toBe(0xB0);

    // Select bank 1
    sys.cart.writeCpu(0x8000, 0x01);
    const v1 = sys.cart.readCpu(0x8000);
    expect(v1 & 0xFF).toBe(0xB1);

    // Wrap around if selecting beyond available banks (e.g., bank 3 -> bank 1)
    sys.cart.writeCpu(0x8000, 0x03);
    const vWrap = sys.cart.readCpu(0x8000);
    expect(vWrap & 0xFF).toBe(0xB1);
  });

  it('toggles one-screen mirroring using bit4 of $8000 writes', () => {
    const rom = makeRom(2);
    const sys = new NESSystem(rom);
    const ppu: any = sys.ppu as any;

    // Force known VRAM values
    ppu['vram'].fill(0);

    // Set single0 (bit4=0) and write to $2000.
    sys.cart.writeCpu(0x8000, 0x00);
    writeVram(sys, 0x2000, 0x5A);
    // With single0, $2000 maps to VRAM[0x000 + offset]
    expect(ppu['vram'][0x000]).toBe(0x5A);
    expect(ppu['vram'][0x400]).toBe(0x00);

    // Switch to single1 (bit4=1) and write new value to $2000.
    sys.cart.writeCpu(0x8000, 0x10);
    writeVram(sys, 0x2000, 0xA5);
    expect(ppu['vram'][0x400]).toBe(0xA5);
    // Ensure previous region is unchanged
    expect(ppu['vram'][0x000]).toBe(0x5A);

    // Toggle back to single0 and confirm we still read/write the original region
    sys.cart.writeCpu(0x8000, 0x00);
    writeVram(sys, 0x2000, 0x3C);
    expect(ppu['vram'][0x000]).toBe(0x3C);
    expect(ppu['vram'][0x400]).toBe(0xA5);
  });
});
