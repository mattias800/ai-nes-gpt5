import { describe, it, expect } from 'vitest';
import { CPUBus } from '@core/bus/memory';
import { NesIO } from '@core/io/nesio';
import { PPU } from '@core/ppu/ppu';

function writeRead(bus: CPUBus, io: NesIO, a: number, v: number, b: number) {
  io.ppu.cpuWrite(0x2006, (a >> 8) & 0xFF);
  io.ppu.cpuWrite(0x2006, a & 0xFF);
  io.ppu.cpuWrite(0x2007, v);
  io.ppu.cpuWrite(0x2006, (b >> 8) & 0xFF);
  io.ppu.cpuWrite(0x2006, b & 0xFF);
  // First read returns buffered; second returns real
  io.ppu.cpuRead(0x2007);
  return io.ppu.cpuRead(0x2007);
}

describe('CPUBus PPU register mirroring', () => {
  it('mirrors $2000-$2007 across $2008-$3FFF for reads and writes', () => {
    const bus = new CPUBus();
    const ppu = new PPU();
    const io = new NesIO(ppu, bus);
    bus.connectIO(io.read, io.write);

    // Write PPUCTRL via $2000 and mirror at $2008
    bus.write(0x2000, 0x80);
    expect(bus.read(0x2008)).toBe(0x00); // reading status via mirror would be 0 unless vblank; check write path via direct readback

    // Verify name table RAM through mirrored registers: write via $2007 using mirrored $2006/$2007 addresses
    // Set address via mirrored $2006
    bus.write(0x2006 + 8, 0x20);
    bus.write(0x2006 + 8, 0x00);
    // Write data via mirrored $2007
    bus.write(0x2007 + 8, 0xAA);
    // Read back via base $2006/$2007
    bus.write(0x2006, 0x20);
    bus.write(0x2006, 0x00);
    // buffered then real
    bus.read(0x2007);
    const val = bus.read(0x2007);
    expect(val).toBe(0xAA);

    // Test mirroring at 0x3FFF for reads: mirror of 0x2007 register space
    // Put address to palette and write
    bus.write(0x2006, 0x3F);
    bus.write(0x2006, 0x00);
    bus.write(0x2007, 0x2A);
    // Read from 0x3FFF (should mirror 0x2007, palette read unbuffered)
    // Reset address back to 0x3F00 because write to $2007 incremented v
    bus.write(0x2006, 0x3F);
    bus.write(0x2006, 0x00);
    const r = bus.read(0x3FFF);
    expect((r & 0x3F)).toBe(0x2A);
  });
});

