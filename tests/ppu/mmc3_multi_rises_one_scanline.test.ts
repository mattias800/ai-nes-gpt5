import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';
import { MMC3 } from '@core/cart/mappers/mmc3';

function setAddr(ppu: PPU, addr14: number) {
  ppu.cpuWrite(0x2006, (addr14 >> 8) & 0x3F);
  ppu.cpuWrite(0x2006, addr14 & 0xFF);
}
function readAt(ppu: PPU, addr14: number) {
  setAddr(ppu, addr14 & 0x3FFF);
  ppu.cpuRead(0x2007);
}

describe('MMC3 multiple rises within one scanline are deglitched to one', () => {
  it('quick A12 toggles (<8 dots low) do not cause extra counts', () => {
    const ppu = new PPU();
    ppu.reset();

    const prg = new Uint8Array(16 * 0x4000);
    const mmc3 = new MMC3(prg);

    ppu.connectCHR((a) => mmc3.ppuRead(a), (a, v) => mmc3.ppuWrite(a, v));
    ppu.setA12Hook(() => mmc3.notifyA12Rise());

    // Latch=1, reload on next rise, IRQ enable
    mmc3.cpuWrite(0xC000, 1);
    mmc3.cpuWrite(0xC001, 0);
    mmc3.cpuWrite(0xE001, 0);

    // Valid rise (8-dot low) -> reload to 1
    readAt(ppu, 0x0FF8); ppu.tick(8); readAt(ppu, 0x1000);
    expect(mmc3.irqPending!()).toBe(false);

    // Attempt fast extra rise (<8 dots low) in same region -> ignored
    readAt(ppu, 0x0FF8); ppu.tick(4); readAt(ppu, 0x1000);
    expect(mmc3.irqPending!()).toBe(false);

    // Another valid rise (>=8 dots low) -> 1->0 IRQ
    readAt(ppu, 0x0FF8); ppu.tick(8); readAt(ppu, 0x1000);
    expect(mmc3.irqPending!()).toBe(true);
  });
});

