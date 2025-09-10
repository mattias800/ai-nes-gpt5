import type { Byte } from "@core/cpu/types";

export interface INesRom {
  prg: Uint8Array;
  chr: Uint8Array; // may be empty (CHR RAM)
  mapper: number;
  hasTrainer: boolean;
  prgRamSize: number; // batteryless WRAM (if known)
  flags6: Byte;
  flags7: Byte;
  // NES 2.0 extensions (optional for backward compatibility with tests)
  isNES2?: boolean;
  submapper?: number;
  prgNvramSize?: number; // battery-backed PRG RAM
  chrRamSize?: number;
  chrNvramSize?: number;
  timing?: 'ntsc' | 'pal' | 'multi' | 'dendy';
}

function decodeRamNibble(n: number): number {
  // NES 2.0 RAM/NVRAM size encoding: 0->0, else size = 64 << n (bytes)
  if ((n & 0x0F) === 0) return 0;
  return 64 << (n & 0x0F);
}

export function parseINes(buffer: Uint8Array): INesRom {
  if (buffer.length < 16) throw new Error("Invalid iNES file");
  if (String.fromCharCode(...buffer.slice(0, 4)) !== 'NES\u001a') throw new Error("Invalid iNES header");
  const flags6 = buffer[6] & 0xFF as Byte;
  const flags7 = buffer[7] & 0xFF as Byte;
  const hasTrainer = !!(flags6 & 0x04);

  let mapper = ((flags6 >> 4) & 0x0F) | (flags7 & 0xF0);
  let submapper = 0;
  let prgBanks = buffer[4] & 0xFF;
  let chrBanks = buffer[5] & 0xFF;
  let isNES2 = false;
  let prgRamSize = 8 * 1024; // default fallback
  let prgNvramSize = 0;
  let chrRamSize = 0;
  let chrNvramSize = 0;
  let timing: 'ntsc' | 'pal' | 'multi' | 'dendy' | undefined = undefined;

  // NES 2.0 detection: flags7 bits 2..3 == 0b10
  if (((flags7 & 0x0C) >>> 2) === 0b10) {
    isNES2 = true;
    const b8 = buffer[8] & 0xFF;
    const b9 = buffer[9] & 0xFF;
    mapper |= ((b8 & 0xF0) << 4); // mapper bits 8..11
    submapper = (b8 & 0x0F);

    prgBanks |= (b9 & 0x0F) << 8; // extend PRG ROM banks (16KB units)
    chrBanks |= ((b9 >> 4) & 0x0F) << 8; // extend CHR ROM banks (8KB units)

    const b10 = buffer[10] & 0xFF;
    const b11 = buffer[11] & 0xFF;
    prgRamSize = decodeRamNibble(b10 & 0x0F);
    prgNvramSize = decodeRamNibble((b10 >> 4) & 0x0F);
    chrRamSize = decodeRamNibble(b11 & 0x0F);
    chrNvramSize = decodeRamNibble((b11 >> 4) & 0x0F);

    const b12 = buffer[12] & 0xFF;
    const timingCode = b12 & 0x03;
    timing = timingCode === 0 ? 'ntsc' : timingCode === 1 ? 'pal' : timingCode === 2 ? 'multi' : 'dendy';
  }

  const prgSize = (prgBanks >>> 0) * 16 * 1024;
  const chrSize = (chrBanks >>> 0) * 8 * 1024;

  let offset = 16;
  if (hasTrainer) offset += 512;
  const prg = buffer.slice(offset, offset + prgSize);
  offset += prgSize;
  const chr = chrSize ? buffer.slice(offset, offset + chrSize) : new Uint8Array(0);

  // If CHR ROM absent and NES 2.0 specified a CHR RAM size, we could allocate that here,
  // but downstream mappers already allocate CHR RAM on demand. We still expose sizes for future use.

  return {
    prg,
    chr,
    mapper,
    hasTrainer,
    prgRamSize,
    flags6,
    flags7,
    isNES2,
    submapper,
    prgNvramSize,
    chrRamSize,
    chrNvramSize,
    timing,
  };
}
