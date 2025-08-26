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

describe('MMC3 enable/disable across scanlines with deglitch', () => {
  it('disabled rises across lines do not assert; re-enabled counts resume', () => {
    const ppu = new PPU(); ppu.reset();
    const mmc3 = new MMC3(new Uint8Array(16 * 0x4000));
    ppu.connectCHR((a) => mmc3.ppuRead(a), (a, v) => mmc3.ppuWrite(a, v));
    ppu.setA12Hook(() => mmc3.notifyA12Rise());

    // latch=1, request reload, enable
    mmc3.cpuWrite(0xC000, 1);
    mmc3.cpuWrite(0xC001, 0);
    mmc3.cpuWrite(0xE001, 0);

    // Valid rise -> reload to 1
    readAt(ppu, 0x0FF8); ppu.tick(8); readAt(ppu, 0x1000);
    expect(mmc3.irqPending!()).toBe(false);

    // Disable, then generate several valid rises across scanlines -> no IRQ
    mmc3.cpuWrite(0xE000, 0);
    readAt(ppu, 0x0FF8); ppu.tick(8); readAt(ppu, 0x1000); // dec to 0 but disabled
    expect(mmc3.irqPending!()).toBe(false);
    // Simulate next line with another reload sequence
    mmc3.cpuWrite(0xC001, 0); // request reload
    readAt(ppu, 0x0FF8); ppu.tick(8); readAt(ppu, 0x1000); // reload to latch
    expect(mmc3.irqPending!()).toBe(false);

    // Re-enable and one more valid rise -> count to 0 and assert
    mmc3.cpuWrite(0xE001, 0);
    readAt(ppu, 0x0FF8); ppu.tick(8); readAt(ppu, 0x1000);
    expect(mmc3.irqPending!()).toBe(true);
  });
});

