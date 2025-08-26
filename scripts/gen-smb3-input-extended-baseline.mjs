import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
let frames = '';
let rom = '';
let script = path.join('tests','smb3','input_script_extended.json');
for (const a of args) {
  if (a.startsWith('--frames=')) frames = a.split('=')[1] || frames;
  if (a.startsWith('--rom=')) rom = a.split('=')[1] || rom;
  if (a.startsWith('--script=')) script = a.split('=')[1] || script;
}

const env = {
  ...process.env,
  SMB3_RECORD_INPUT_EXTENDED_BASELINE: '1',
  PPU_TIMING_DEFAULT: 'vt',
};
if (frames) env.SMB3_STATE_FRAMES = frames; // not used directly by test but kept for symmetry
if (rom) env.SMB3_ROM = rom;
process.env.SMB3_INPUT_SCRIPT = script;

const file = path.join('tests','slow','harness','smb3_input_script_extended.test.ts');
const vitestBin = path.join('node_modules','vitest','vitest.mjs');

const child = spawn(process.execPath, [vitestBin, 'run', file], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code || 0));

