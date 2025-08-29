import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';

function writeAddr(ppu: any, addr: number) {
  ppu.cpuWrite(0x2006, (addr >> 8) & 0xFF);
  ppu.cpuWrite(0x2006, addr & 0xFF);
}
function writePPU(ppu: any, addr: number, val: number) {
  writeAddr(ppu, addr);
  ppu.cpuWrite(0x2007, val & 0xFF);
}
function readPPU(ppu: any, addr: number): number {
  writeAddr(ppu, addr);
  ppu.cpuRead(0x2007); // dummy
  return ppu.cpuRead(0x2007) & 0xFF;
}

describe('MMC2 -> PPU dynamic mirroring control', () => {
  it('toggles mirroring via $F000 and affects PPU nametable mapping', () => {
    // Minimal MMC2 ROM
    const prg = new Uint8Array(2 * 0x4000);
    const chr = new Uint8Array(0x2000);
    const rom: any = { prg, chr, mapper: 9, hasTrainer: false, prgRamSize: 8*1024, flags6: 0x01, flags7: 0 };
    const sys = new NESSystem(rom);
    sys.reset();

    const ppu: any = sys.ppu;

    // Start with vertical mirroring per flags6 bit0=1
    writePPU(ppu, 0x2000, 0x55);
    const vVert = readPPU(ppu, 0x2800);
    expect(vVert & 0xFF).toBe(0x55);

    // Now set MMC2 mirroring to horizontal via $F000 (LSB=1)
    sys.bus.write(0xF000 as any, 0x01);

    // Write to $2000 and expect mirror at $2400 under horizontal mirroring
    writePPU(ppu, 0x2000, 0x66);
    const vHoriz = readPPU(ppu, 0x2400);
    expect(vHoriz & 0xFF).toBe(0x66);
  });
});

