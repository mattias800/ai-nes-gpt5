#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, extname } from 'node:path';
import { parseINes } from '@core/cart/ines';
import { Cartridge } from '@core/cart/cartridge';

function parseArgs(argv: string[]): { rom: string, out?: string } {
  const args: any = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) args[m[1]] = m[2];
  }
  if (!args.rom) {
    // eslint-disable-next-line no-console
    console.error('Usage: battery-export --rom=path/to/game.nes [--out=path/to/game.sav]');
    process.exit(2);
  }
  return { rom: args.rom, out: args.out };
}

function defaultSavPath(romPath: string): string {
  const dir = dirname(romPath);
  const base = basename(romPath, extname(romPath));
  return join(dir, `${base}.sav`);
}

(function main() {
  const { rom: romPath, out } = parseArgs(process.argv.slice(2));
  const buf = new Uint8Array(readFileSync(romPath));
  const rom = parseINes(buf);
  const cart = new Cartridge(rom);
  const sav = cart.exportBatteryRam();
  if (!sav) {
    // eslint-disable-next-line no-console
    console.log('No battery RAM present for this ROM. Nothing to export.');
    process.exit(0);
  }
  const outPath = out || defaultSavPath(romPath);
  writeFileSync(outPath, sav);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${sav.length} bytes to ${outPath}`);
})();
