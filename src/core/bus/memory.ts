import type { Byte, Word } from "@core/cpu/types";

export interface BusDevice {
  read(addr: Word): Byte;
  write(addr: Word, value: Byte): void;
  tick?(cpuCycles: number): void; // optional for PPU/APU sync
}

export class CPUBus implements BusDevice {
  private ram = new Uint8Array(0x800); // 2KB internal RAM
  // Placeholders for PPU/APU/IO/cart
  private readIO: (addr: Word) => Byte = () => 0x00;
  private writeIO: (addr: Word, value: Byte) => void = () => {};
  private cartRead: (addr: Word) => Byte = () => 0x00;
  private cartWrite: (addr: Word, value: Byte) => void = () => {};

  connectIO(readFn: (addr: Word) => Byte, writeFn: (addr: Word, value: Byte) => void) {
    this.readIO = readFn;
    this.writeIO = writeFn;
  }

  connectCart(readFn: (addr: Word) => Byte, writeFn: (addr: Word, value: Byte) => void) {
    this.cartRead = readFn;
    this.cartWrite = writeFn;
  }

  read(addr: Word): Byte {
    addr &= 0xFFFF;
    if (addr < 0x2000) {
      return this.ram[addr & 0x07FF];
    }
    if (addr < 0x4000) {
      // PPU registers mirrored every 8 bytes
      return this.readIO(0x2000 + (addr & 0x7));
    }
    if (addr < 0x4020) {
      return this.readIO(addr);
    }
    return this.cartRead(addr);
  }

  write(addr: Word, value: Byte): void {
    addr &= 0xFFFF; value &= 0xFF;
    if (addr < 0x2000) {
      this.ram[addr & 0x07FF] = value;
      return;
    }
    if (addr < 0x4000) {
      this.writeIO(0x2000 + (addr & 0x7), value);
      return;
    }
    if (addr < 0x4020) {
      this.writeIO(addr, value);
      return;
    }
    this.cartWrite(addr, value);
  }
}
