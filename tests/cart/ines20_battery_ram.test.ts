import { describe, it, expect } from 'vitest';
import { parseINes } from '@core/cart/ines';
import { Cartridge } from '@core/cart/cartridge';

const makeNES2_withPrgNv = (nvNibble: number, ramNibble: number) => {
  const h = new Uint8Array(16);
  h[0]=0x4E; h[1]=0x45; h[2]=0x53; h[3]=0x1A;
  h[4]=1; // 16KB PRG
  h[5]=0; // CHR 0
  h[6]=0x00; // mapper 0
  h[7]=0x08; // NES 2.0
  h[8]=0x00; h[9]=0x00;
  h[10]=((nvNibble & 0x0F) << 4) | (ramNibble & 0x0F);
  h[11]=0x00; h[12]=0x00;
  const prg = new Uint8Array(16*1024);
  const buf = new Uint8Array(16+prg.length);
  buf.set(h,0); buf.set(prg,16);
  return buf;
};

describe('Battery RAM export/import via Cartridge', () => {
  it('uses PRG NVRAM size from NES 2.0 header and round-trips data', () => {
    // nvNibble=6 -> 4096 bytes; ramNibble=2 -> 256 bytes (non-battery)
    const romBuf = makeNES2_withPrgNv(6, 2);
    const rom = parseINes(romBuf);
    const cart = new Cartridge(rom);

    // Write some bytes into the battery region (which follows non-battery region)
    // Non-battery RAM size = 64<<2 = 256
    const base = 0x6000 + 256;
    for (let i=0; i<8; i++) cart.writeCpu((base + i) as any, (0xA0 + i) & 0xFF);

    const dumped = cart.exportBatteryRam();
    expect(dumped).not.toBeNull();
    expect(dumped!.length).toBe(4096);
    for (let i=0;i<8;i++) expect(dumped![i]).toBe((0xA0 + i) & 0xFF);

    // Clear and re-import
    for (let i=0; i<8; i++) cart.writeCpu((base + i) as any, 0x00);
    cart.importBatteryRam(dumped!);

    for (let i=0; i<8; i++) expect(cart.readCpu((base + i) as any) & 0xFF).toBe((0xA0 + i) & 0xFF);
  });
});
