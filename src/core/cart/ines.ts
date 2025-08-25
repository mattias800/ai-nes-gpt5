import type { Byte } from "@core/cpu/types";

export interface INesRom {
  prg: Uint8Array;
  chr: Uint8Array; // may be empty (CHR RAM)
  mapper: number;
  hasTrainer: boolean;
  prgRamSize: number;
  flags6: Byte;
  flags7: Byte;
}

export function parseINes(buffer: Uint8Array): INesRom {
  if (buffer.length < 16) throw new Error("Invalid iNES file");
  if (String.fromCharCode(...buffer.slice(0, 4)) !== 'NES\u001a') throw new Error("Invalid iNES header");
  const prgBanks = buffer[4];
  const chrBanks = buffer[5];
  const flags6 = buffer[6];
  const flags7 = buffer[7];
  const hasTrainer = !!(flags6 & 0x04);
  const mapper = (flags6 >> 4) | (flags7 & 0xF0);
  const prgSize = prgBanks * 16 * 1024;
  const chrSize = chrBanks * 8 * 1024;
  let offset = 16;
  if (hasTrainer) offset += 512;
  const prg = buffer.slice(offset, offset + prgSize);
  offset += prgSize;
  const chr = chrSize ? buffer.slice(offset, offset + chrSize) : new Uint8Array(0);
  return { prg, chr, mapper, hasTrainer, prgRamSize: 8 * 1024, flags6, flags7 };
}
