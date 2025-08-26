import { spawn } from 'node:child_process';
import path from 'node:path';

const vitestBin = path.join('node_modules','vitest','vitest.mjs');

const buckets = [
  { name: 'cpu', patterns: ['tests/cpu/**/*.test.ts'] },
  { name: 'ppu', patterns: ['tests/ppu/**/*.test.ts'] },
  { name: 'mappers', patterns: ['tests/mappers/**/*.test.ts'] },
  { name: 'apu', patterns: ['tests/apu/**/*.test.ts'] },
  { name: 'system', patterns: ['tests/system/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/input/**/*.test.ts'] },
  { name: 'smb3', patterns: ['tests/slow/harness/smb3_*.test.ts'] },
];

function runBucket(name, patterns) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(process.execPath, [vitestBin, 'run', ...patterns], { stdio: 'inherit' });
    child.on('exit', (code) => {
      resolve({ name, patterns, code: code || 0, durationMs: Date.now() - start });
    });
  });
}

(async () => {
  const results = [];
  for (const b of buckets) {
    const r = await runBucket(b.name, b.patterns);
    results.push(r);
  }
  const summary = {
    timestamp: new Date().toISOString(),
    results: results.map(r => ({ name: r.name, code: r.code, durationMs: r.durationMs })),
    ok: results.every(r => r.code === 0),
  };
  console.log('\nAccuracy report summary:\n' + JSON.stringify(summary, null, 2));
  process.exit(summary.ok ? 0 : 1);
})();

