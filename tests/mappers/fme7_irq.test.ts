import { describe, it, expect } from 'vitest';
import { FME7 } from '@core/cart/mappers/fme7';

function mk(prgBanks8k: number) {
  const prg = new Uint8Array(prgBanks8k * 0x2000);
  const chr = new Uint8Array(0x2000); // CHR RAM for simplicity
  const m = new FME7(prg, chr);
  return m as any;
}

describe('FME-7 IRQ minimal', () => {
  it('one-shot IRQ fires after reload cycles, then disables', () => {
    const m = mk(8);
    // Set reload = 16
    m.cpuWrite(0x8000, 13); m.cpuWrite(0xA000, 16 & 0xFF);
    m.cpuWrite(0x8000, 14); m.cpuWrite(0xA000, (16 >>> 8) & 0xFF);
    // Enable, one-shot (bit0=1, bit1=0)
    m.cpuWrite(0x8000, 15); m.cpuWrite(0xA000, 0x01);

    // Tick fewer than reload
    m.tick(10);
    expect(m.irqPending()).toBe(false);
    // Tick remaining
    m.tick(6);
    expect(m.irqPending()).toBe(true);

    // After firing, with one-shot, further ticks keep it disabled
    m.tick(100);
    expect(m.irqPending()).toBe(true); // line stays until cleared
    // Clear IRQ via control ack bit7
    m.cpuWrite(0x8000, 15); m.cpuWrite(0xA000, 0x80);
    expect(m.irqPending()).toBe(false);
  });

  it('repeat mode re-arms counter after each fire', () => {
    const m = mk(8);
    // Reload = 5, enable repeat (bit1)
    m.cpuWrite(0x8000, 13); m.cpuWrite(0xA000, 5);
    m.cpuWrite(0x8000, 14); m.cpuWrite(0xA000, 0);
    m.cpuWrite(0x8000, 15); m.cpuWrite(0xA000, 0x03); // enable+repeat

    m.tick(4);
    expect(m.irqPending()).toBe(false);
    m.tick(1);
    expect(m.irqPending()).toBe(true);
    // Ack, stays enabled and should fire again after 5 more cycles
    m.cpuWrite(0x8000, 15); m.cpuWrite(0xA000, 0x83);
    expect(m.irqPending()).toBe(false);
    m.tick(5);
    expect(m.irqPending()).toBe(true);
  });
});

