import type { Byte, Word } from "@core/cpu/types";

// One-shot disassembly provider type: given a memory read, return a formatted line and the PC
export type DisasmOneShot = (read: (addr: Word) => Byte) => { line: string, pc: number };

export interface BusDevice {
  read(addr: Word): Byte;
  write(addr: Word, value: Byte): void;
  tick?(cpuCycles: number): void; // optional for PPU/APU sync
}

export class CPUBus implements BusDevice {
  constructor() {
    // Optional RAM init pattern for debugging alignment (e.g., match external emulator power-on RAM)
    try {
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined)
      const fillStr = env?.NES_RAM_INIT as string | undefined
      if (fillStr) {
        const v = parseInt(fillStr, 16) & 0xFF
        this.ram.fill(v)
      }
    } catch {}
  }
  private ram = new Uint8Array(0x800); // 2KB internal RAM
  private cpuCycleProvider: (() => number) | null = null;
  public setCpuCycleProvider(fn: () => number): void { this.cpuCycleProvider = fn; }

  // Debug providers for one-shot hooks
  private pcProvider: (() => number) | null = null;
  private disasmProvider: DisasmOneShot | null = null;
  private prgMapProvider: (() => string) | null = null;
  public setPcProvider(fn: () => number): void { this.pcProvider = fn; }
  // Provide a function that accepts a readByte(addr) and returns a formatted disassembly row and pc
  public setDisasmProvider(fn: DisasmOneShot): void { this.disasmProvider = fn; }
  // Provide a function that returns a formatted PRG map summary string
  public setPrgMapProvider(fn: () => string): void { this.prgMapProvider = fn; }
  public loadRAM(data: Uint8Array, offset = 0): void {
    const n = Math.min(this.ram.length - (offset|0), data.length)
    if (n > 0) this.ram.set(data.subarray(0, n), offset|0)
  }
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
      // Optional targeted trace for internal RAM/zero-page writes
      try {
        const env = (typeof process !== 'undefined' ? (process as any).env : undefined)
        if (env && env.TRACE_ZP_WATCH === '1') {
          const cyc = this.cpuCycleProvider ? this.cpuCycleProvider() : 0;
          const win = env.TRACE_WRITE_WINDOW as string | undefined;
          let inWin = true;
          if (win) {
            const m = /^(\d+)-(\d+)$/.exec(win);
            if (m) { const a = parseInt(m[1], 10) | 0; const b = parseInt(m[2], 10) | 0; inWin = cyc >= a && cyc <= b; }
          }
          let addrMatch = false;
          const def = new Set([0x009A, 0x009B, 0x009C, 0x009D]);
          const addrs = env.TRACE_ZP_ADDRS as string | undefined;
          if (addrs) {
            const set = new Set(addrs.split(',').map(s => parseInt(s.trim(), 16) & 0xFFFF));
            addrMatch = set.has(addr);
          } else {
            addrMatch = def.has(addr);
          }
          if (inWin && addrMatch) {
            // eslint-disable-next-line no-console
            console.log(`[zp] write $${addr.toString(16).padStart(4,'0')} <= $${value.toString(16).padStart(2,'0')} at CPU cyc=${cyc}`)
          }
          // One-shot hook: when writing $009A with bit6 set, dump PC, a disasm line, and current PRG mapping
          if (addr === 0x009A && (value & 0x40) !== 0 && env.TRACE_ZP_ONESHOT_009A === '1') {
            const pc = this.pcProvider ? (this.pcProvider() & 0xFFFF) : -1;
            let dis = '';
            try {
              if (this.disasmProvider) {
                const rd = (a: number) => this.read(a & 0xFFFF) & 0xFF;
                const d = this.disasmProvider(rd);
                dis = d.line;
              }
            } catch {}
            let map = '';
            try { if (this.prgMapProvider) map = this.prgMapProvider() || ''; } catch {}
            // eslint-disable-next-line no-console
            console.log(`[oneshot] 009A<=${value.toString(16).padStart(2,'0')} pc=$${pc>=0?pc.toString(16).padStart(4,'0'):'????'} ${dis}${map?` ${map}`:''}`);
          }
        }
      } catch {}
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
