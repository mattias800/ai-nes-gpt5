import { describe, it, expect } from 'vitest';
import { PPU } from '@core/ppu/ppu';
import { MMC3 } from '@core/cart/mappers/mmc3';

// Replicate the blargg mmc3_test clock_counter via $2006 and ensure no spurious IRQ

describe('MMC3 clocking via PPUADDR toggles', () => {
  it('after setting latch=10 and enabling, two clocks should not assert IRQ', () => {
    const ppu = new PPU();
    ppu.reset();
    // Disable rendering
    ppu.cpuWrite(0x2001, 0x00);

    const mmc3 = new MMC3(new Uint8Array(0x8000));
    ppu.connectCHR((a) => mmc3.ppuRead(a), (a, v) => mmc3.ppuWrite(a, v));
    ppu.setA12Hook(() => mmc3.notifyA12Rise());

    // Begin counter test mimicking the ROM
    // Avoid pathological reload behavior
    clockCounter(ppu);
    clockCounter(ppu);

    // Set reload to 10
    mmc3.cpuWrite(0xC000, 10);
    // Clear counter -> reload on next rise
    mmc3.cpuWrite(0xC001, 0);
    // Clear then enable IRQ
    mmc3.cpuWrite(0xE000, 0);
    mmc3.cpuWrite(0xE001, 0);

    // One clock: reload to 10
    clockCounter(ppu);
    expect(mmc3.irqPending && mmc3.irqPending()).toBe(false);
    // Second clock: 10 -> 9
    clockCounter(ppu);
    expect(mmc3.irqPending && mmc3.irqPending()).toBe(false);
  });
});

function clockCounter(ppu: PPU) {
  // Emulate ROM sequence:
  //   setb PPUADDR,0; sta PPUADDR
  //   setb PPUADDR,$10; sta PPUADDR
  //   setb PPUADDR,0; sta PPUADDR
  ppu.cpuWrite(0x2006, 0x00);
  ppu.cpuWrite(0x2006, 0x00); // low byte arbitrary
  ppu.cpuWrite(0x2006, 0x10);
  ppu.cpuWrite(0x2006, 0x00);
  ppu.cpuWrite(0x2006, 0x00);
  ppu.cpuWrite(0x2006, 0x00);
}

