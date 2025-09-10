#!/usr/bin/env tsx
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { parseINes } from '@core/cart/ines';

const IMPLEMENTED = new Set<number>([
  0,1,2,3,4,7,9,11,66,71,206,
]);

function* walk(dir: string): Generator<string> {
  const entries = readdirSync(dir);
  for (const e of entries) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (st.isFile() && extname(p).toLowerCase() === '.nes') yield p;
  }
}

(function main() {
  const arg = process.argv.find(a => a.startsWith('--dir='));
  const dir = arg ? arg.slice('--dir='.length) : 'roms';
  let total = 0, impl = 0;
  for (const file of walk(dir)) {
    total++;
    const buf = new Uint8Array(readFileSync(file));
    try {
      const rom = parseINes(buf);
      const mapped = rom.mapper;
      const sub = (rom as any).submapper;
      const ok = IMPLEMENTED.has(mapped);
      if (ok) impl++;
      // eslint-disable-next-line no-console
      console.log(`${ok ? '[OK]':'[--]'} ${file}  mapper=${mapped}${(sub!==undefined)?`.${sub}`:''}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.log(`[ERR] ${file}: ${(e as Error).message}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`\nScanned ${total} ROMs; implemented mappers cover ${impl}/${total}`);
})();
