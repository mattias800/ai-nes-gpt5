import type { Byte, Word } from '@core/cpu/types';

export interface Mapper {
  cpuRead(addr: Word): Byte;
  cpuWrite(addr: Word, value: Byte): void;
  ppuRead(addr: Word): Byte; // CHR space $0000-$1FFF
  ppuWrite(addr: Word, value: Byte): void; // CHR RAM write if present
  tick?(cpuCycles: number): void;
  irqPending?(): boolean; // For mappers with IRQs (e.g., MMC3/MMC5)
  clearIrq?(): void;
  notifyA12Rise?(): void; // Call when PPU A12 rises (MMC3)
  // Optional: mapper-controlled mirroring (support one-screen for AxROM)
  setMirrorCallback?(cb: (mode: 'horizontal' | 'vertical' | 'single0' | 'single1') => void): void;
  // Optional battery-backed RAM accessors (PRG NVRAM)
  getBatteryRam?(): Uint8Array | null;
  setBatteryRam?(data: Uint8Array): void;
  // Optional: mapper-provided Nametable overrides (MMC5)
  ppuNTRead?(addr: Word): Byte; // PPU $2000-$2FFF/$3000-$3EFF
  ppuNTWrite?(addr: Word, value: Byte): void;
  // Optional: allow System/PPU to provide direct CIRAM accessors to mapper (MMC5)
  setCIRAMAccessors?(read: (addr: Word) => Byte, write: (addr: Word, value: Byte) => void, readPage: (page: 0|1, offset: number) => Byte, writePage: (page: 0|1, offset: number, value: Byte) => void): void;
  // Optional: provide a PPU time provider for scanline/cycle-aware IRQs
  setTimeProvider?(fn: () => { frame: number, scanline: number, cycle: number }): void;
}

export interface CartWires {
  readCpu: (addr: Word) => Byte;
  writeCpu: (addr: Word, value: Byte) => void;
  readChr: (addr: Word) => Byte;
  writeChr: (addr: Word, value: Byte) => void;
}
