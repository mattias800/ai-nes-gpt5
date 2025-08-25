import { describe, it, expect } from 'vitest';
import { CPUBus } from '@core/bus/memory';
import { CPU6502 } from '@core/cpu/cpu';
import { PPU } from '@core/ppu/ppu';
import { NesIO } from '@core/io/nesio';

// Program: LDA #$02; STA $4014

describe('OAM DMA CPU stall', () => {
  it('adds 513/514 cycles on $4014 write', () => {
    const bus = new CPUBus();
    const ppu = new PPU();
    const io = new NesIO(ppu, bus);
    bus.connectIO(io.read, io.write);

    const prg = new Uint8Array(0x8000);
    prg.set([0xA9, 0x02, 0x8D, 0x14, 0x40], 0);
    bus.connectCart((addr) => (addr >= 0x8000 ? prg[(addr - 0x8000) & 0x7FFF] : 0x00), (_a, _v) => {});

    const cpu = new CPU6502(bus);
    io.setCpuCycleHooks(() => cpu.state.cycles, (n) => cpu.addCycles(n));
    cpu.reset(0x8000);

    cpu.step(); // LDA #$02
    const before = cpu.state.cycles;
    cpu.step(); // STA $4014 triggers DMA stall
    const after = cpu.state.cycles;
    const delta = after - before;
    // STA costs 4 cycles; stall adds 513 or 514
    expect(delta === 4 + 513 || delta === 4 + 514).toBe(true);
  });
});
