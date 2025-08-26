import type { Byte, Word } from '@core/cpu/types';

export interface Mapper {
  cpuRead(addr: Word): Byte;
  cpuWrite(addr: Word, value: Byte): void;
  ppuRead(addr: Word): Byte; // CHR space $0000-$1FFF
  ppuWrite(addr: Word, value: Byte): void; // CHR RAM write if present
  tick?(cpuCycles: number): void;
  irqPending?(): boolean; // For mappers with IRQs (e.g., MMC3)
  clearIrq?(): void;
  notifyA12Rise?(): void; // Call when PPU A12 rises (MMC3)
  setMirrorCallback?(cb: (mode: 'horizontal' | 'vertical') => void): void; // Optional: mapper-controlled mirroring
}

export interface CartWires {
  readCpu: (addr: Word) => Byte;
  writeCpu: (addr: Word, value: Byte) => void;
  readChr: (addr: Word) => Byte;
  writeChr: (addr: Word, value: Byte) => void;
}
