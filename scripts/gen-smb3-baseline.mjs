import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
let title = '120';
let deep = '600';
let rom = '';
for (const a of args) {
  if (a.startsWith('--title-frames=')) title = a.split('=')[1] || title;
  if (a.startsWith('--deep-frames=')) deep = a.split('=')[1] || deep;
  if (a.startsWith('--rom=')) rom = a.split('=')[1] || rom;
}

const env = {
  ...process.env,
  SMB3_RECORD_BASELINE: '1',
  SMB3_TITLE_FRAMES: title,
  SMB3_DEEP_FRAMES: deep,
  PPU_TIMING_DEFAULT: 'vt',
};
if (rom) env.SMB3_ROM = rom;

const files = [
  path.join('tests','slow','harness','smb3_title_crc.test.ts'),
  path.join('tests','slow','harness','smb3_deep_crc.test.ts'),
];
const vitestBin = path.join('node_modules','vitest','vitest.mjs');

function runOne(file) {
  return new Promise((resolve) => {
    console.log(`Recording SMB3 baseline for ${file}...`);
    const child = spawn(process.execPath, [vitestBin, 'run', file], { stdio: 'inherit', env });
    child.on('exit', (code) => resolve(code || 0));
  });
}

(async () => {
  let exitCode = 0;
  for (const f of files) {
    const code = await runOne(f);
    if (code) exitCode = code;
  }
  process.exit(exitCode);
})();

