import { describe, it, expect } from 'vitest';
import { CPUBus } from '@core/bus/memory';
import { NesIO } from '@core/io/nesio';
import { PPU } from '@core/ppu/ppu';

function bit(b: number) { return b & 1; }

describe('Controllers $4016/$4017', () => {
  it('latches and shifts button states bit-by-bit', () => {
    const bus = new CPUBus();
    const ppu = new PPU();
    const io = new NesIO(ppu, bus);
    bus.connectIO(io.read, io.write);

    // Press A and Right on pad1
    io.getController(1)['setButton']('A', true);
    io.getController(1)['setButton']('Right', true);

    // Strobe high then low to latch
    io.write(0x4016, 1);
    io.write(0x4016, 0);

    // Read 8 bits from $4016
    const reads: number[] = [];
    for (let i=0;i<8;i++) reads.push(io.read(0x4016));
    const bits = reads.map(r => r & 1);
    // Expect order: A,B,Select,Start,Up,Down,Left,Right
    expect(bits).toEqual([1,0,0,0,0,0,0,1]);

    // Further reads should return 1s
    expect(bit(io.read(0x4016))).toBe(1);
    expect(bit(io.read(0x4016))).toBe(1);
  });
});
