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

// Verify that MMC3 A000 mirroring control is wired to PPU.setMirroring

describe('MMC3 -> PPU dynamic mirroring control', () => {
  it('toggles mirroring via $A000 and affects PPU nametable mapping', () => {
    // Create a minimal MMC3 ROM definition
    const prg = new Uint8Array(2 * 0x4000); // 32KB
    const chr = new Uint8Array(0x2000); // 8KB
    const rom: any = { prg, chr, mapper: 4, hasTrainer: false, prgRamSize: 8*1024, flags6: 0x01, flags7: 0 };
    const sys = new NESSystem(rom);
    sys.reset();

    const ppu: any = sys.ppu;

    // Start with vertical mirroring from flags6 bit0=1
    // Write to $2000 and expect mirror at $2800 initially
    writePPU(ppu, 0x2000, 0x55);
    writeAddr(ppu, 0x2800);
    ppu.cpuRead(0x2007); // buffered
    const vVert = ppu.cpuRead(0x2007);
    expect(vVert & 0xFF).toBe(0x55);

    // Now set MMC3 mirroring to horizontal via $A000 (value LSB=1)
    sys.bus.write(0xA000 as any, 0x01);

    // Write to $2000 and expect mirror at $2400 under horizontal mirroring
    writePPU(ppu, 0x2000, 0x66);
    writeAddr(ppu, 0x2400);
    ppu.cpuRead(0x2007);
    const vHoriz = ppu.cpuRead(0x2007);
    expect(vHoriz & 0xFF).toBe(0x66);
  });
});

