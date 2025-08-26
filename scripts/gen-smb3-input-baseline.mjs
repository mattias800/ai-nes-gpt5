import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';

const args = process.argv.slice(2);
let script = path.join('tests','resources','smb3.input.json');
let frames = '';
let rom = '';
for (const a of args) {
  if (a.startsWith('--script=')) script = a.split('=')[1] || script;
  if (a.startsWith('--frames=')) frames = a.split('=')[1] || frames;
  if (a.startsWith('--rom=')) rom = a.split('=')[1] || rom;
}

if (!fs.existsSync(script)) {
  console.error(`Input script not found: ${script}`);
  process.exit(2);
}

const env = {
  ...process.env,
  SMB3_RECORD_INPUT_BASELINE: '1',
  PPU_TIMING_DEFAULT: 'vt',
};
if (frames) env.SMB3_STATE_FRAMES = frames;
if (rom) env.SMB3_ROM = rom;

// Ensure script is present where the test expects
process.env.SMB3_INPUT_SCRIPT = script;

const file = path.join('tests','slow','harness','smb3_input_script_crc.test.ts');
const vitestBin = path.join('node_modules','vitest','vitest.mjs');

const child = spawn(process.execPath, [vitestBin, 'run', file], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code || 0));

