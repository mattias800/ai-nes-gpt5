import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
let frames = '60';
let rom = '';
for (const a of args) {
  if (a.startsWith('--frames=')) frames = a.split('=')[1] || frames;
  if (a.startsWith('--rom=')) rom = a.split('=')[1] || rom;
}

const env = {
  ...process.env,
  SMB_RECORD_BASELINE: '1',
  SMB_FRAMES: frames,
  PPU_TIMING_DEFAULT: 'vt',
};
if (rom) env.SMB_ROM = rom;

const testFile = path.join('tests', 'harness', 'smb_deterministic_crc.test.ts');
const vitestBin = path.join('node_modules', 'vitest', 'vitest.mjs');

console.log(`Recording SMB baseline (frames=${frames})...`);
const child = spawn(process.execPath, [vitestBin, 'run', testFile], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code || 0));

