#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';
import { basename, dirname, join, extname } from 'node:path';
import { parseINes } from '@core/cart/ines';
import { Cartridge } from '@core/cart/cartridge';

function parseArgs(argv: string[]): { rom: string, sav?: string } {
  const args: any = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) args[m[1]] = m[2];
  }
  if (!args.rom) {
    // eslint-disable-next-line no-console
    console.error('Usage: battery-import --rom=path/to/game.nes [--sav=path/to/game.sav]');
    process.exit(2);
  }
  return { rom: args.rom, sav: args.sav };
}

function defaultSavPath(romPath: string): string {
  const dir = dirname(romPath);
  const base = basename(romPath, extname(romPath));
  return join(dir, `${base}.sav`);
}

(function main() {
  const { rom: romPath, sav } = parseArgs(process.argv.slice(2));
  const buf = new Uint8Array(readFileSync(romPath));
  const rom = parseINes(buf);
  const cart = new Cartridge(rom);
  const savPath = sav || defaultSavPath(romPath);
  let savBuf: Uint8Array;
  try {
    savBuf = new Uint8Array(readFileSync(savPath));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`Could not read save file: ${savPath}`);
    process.exit(1);
    return;
  }
  cart.importBatteryRam(savBuf);
  // eslint-disable-next-line no-console
  console.log(`Imported ${savBuf.length} bytes into cartridge from ${savPath}`);
})();
