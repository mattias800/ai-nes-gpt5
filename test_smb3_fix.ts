// Test SMB3 with same setup as the passing test
import fs from 'node:fs';
import { NESSystem } from './src/core/system/system.js';
import { parseINes } from './src/core/cart/ines.js';

function findSMB3() {
  // Use the same ROM finding logic as the passing test
  const env = process.env.SMB3_ROM || process.env.SMB_ROM;
  if (env && fs.existsSync(env)) {
    console.log(`Using ROM from env: ${env}`);
    return env;
  }
  const cwd = process.cwd();
  const files = fs.readdirSync(cwd).filter((f) => f.toLowerCase().endsWith('.nes'));
  if (files.length === 0) return null;
  // Prefer smb3/mario3 names, then mario*
  files.sort((a, b) => {
    const ra = rank(a.toLowerCase());
    const rb = rank(b.toLowerCase());
    return ra - rb;
  });
  console.log(`Using ROM from directory: ${files[0]}`);
  return files[0];
  function rank(n: string): number {
    if (n.startsWith('smb3') || n.includes('mario3')) return 0;
    if (n.startsWith('mario')) return 1;
    return 2;
  }
}

async function testSMB3() {
  const romPath = findSMB3();
  if (!romPath) {
    console.error('SMB3 ROM not found');
    return;
  }

  console.log(`Loading ${romPath}...`);
  const rom = parseINes(new Uint8Array(fs.readFileSync(romPath)));
  console.log(`Mapper: ${rom.mapper} (should be 4 for MMC3)`);

  const sys = new NESSystem(rom);
  sys.reset();

  // Enable bg+sprites with left masks visible for consistent CRC (same as passing test)
  sys.io.write(0x2001, 0x1E);

  // Run ~120 frames (same as passing test)
  const frames = 120;
  const start = sys.ppu.frame;
  const target = start + frames;
  let steps = 0;
  const hardCap = 50_000_000;
  while (sys.ppu.frame < target && steps < hardCap) {
    sys.stepInstruction();
    steps++;
  }
  if (steps >= hardCap) throw new Error('SMB3 run timed out');

  // Check framebuffer
  const fb = (sys.ppu as any).getFrameBuffer() as Uint8Array;
  const nonZeroPixels = fb.filter(p => p > 0).length;
  const redPixels = fb.filter(p => p === 0x16).length;

  console.log(`SMB3 results:`);
  console.log(`  Non-zero pixels: ${nonZeroPixels} out of ${fb.length}`);
  console.log(`  Red pixels (0x16): ${redPixels}`);

  // Show most common palette indices
  const paletteCounts = new Array(64).fill(0);
  for (let i = 0; i < fb.length; i++) {
    paletteCounts[fb[i]]++;
  }
  const topColors = paletteCounts
    .map((count, idx) => ({ idx, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .filter(item => item.count > 0);
  console.log(`  Top colors: ${topColors.map(c => `0x${c.idx.toString(16)}(${c.count})`).join(', ')}`);

  if (redPixels < 1000) {
    console.log('✅ SUCCESS: SMB3 is now showing proper graphics!');
  } else {
    console.log('❌ FAILED: SMB3 still shows red clouds');
  }
}

testSMB3().catch(console.error);
