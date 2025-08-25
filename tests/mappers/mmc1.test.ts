import { describe, it, expect } from 'vitest';
import { MMC1 } from '@core/cart/mappers/mmc1';

function writeReg(m: MMC1, addr: number, value: number) {
  // write 5 LSB-first bits
  for (let i = 0; i < 5; i++) {
    const bit = (value >> i) & 1;
    m.cpuWrite(addr, bit);
  }
}

describe('Mapper1: MMC1 PRG mapping modes', () => {
  it('mode 3: switch $8000 and fix last 16KB at $C000', () => {
    const prg = new Uint8Array(0x80000); // 512KB (overkill)
    // fill each 16KB bank with its bank index
    for (let b=0; b<prg.length/0x4000; b++) prg.fill(b, b*0x4000, (b+1)*0x4000);
    const m = new MMC1(prg);

    // control to mode 3 (..11) and chr mode 4KB (bit4=1). value=0b11100=28
    writeReg(m, 0x8000, 0b11100);
    // set PRG bank to 5
    writeReg(m, 0xE000, 5);

    expect(m.cpuRead(0x8000)).toBe(5);
    // last 16KB fixed
    const last = (prg.length/0x4000) - 1;
    expect(m.cpuRead(0xC000)).toBe(last);
  });

  it('mode 2: fix first 16KB at $8000 and switch $C000', () => {
    const prg = new Uint8Array(0x80000);
    for (let b=0; b<prg.length/0x4000; b++) prg.fill(b, b*0x4000, (b+1)*0x4000);
    const m = new MMC1(prg);

    // control to mode 2 (..10)
    writeReg(m, 0x8000, 0b11000);
    // PRG bank to 4
    writeReg(m, 0xE000, 4);

    expect(m.cpuRead(0x8000)).toBe(0); // fixed first
    expect(m.cpuRead(0xC000)).toBe(4);
  });
});
