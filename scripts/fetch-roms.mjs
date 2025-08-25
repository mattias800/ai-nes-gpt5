import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';

const outDir = path.resolve('roms');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.open(dest, 'w');
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', async () => {
        const buf = Buffer.concat(chunks);
        const fh = await file;
        await fh.write(buf);
        await fh.close();
        resolve();
      });
    }).on('error', reject);
  });
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  // Note: URLs are placeholders; replace with known public sources you have locally
  const todo = [
    // { url: 'https://example.com/nestest.nes', file: 'nestest.nes' },
    // { url: 'https://example.com/nestest.log', file: 'nestest.log' },
  ];
  if (todo.length === 0) {
    console.log('No ROM URLs configured. Place test ROMs into ./roms manually.');
    return;
  }
  for (const { url, file } of todo) {
    const dest = path.join(outDir, file);
    if (await exists(dest)) {
      console.log(`Exists: ${file}`);
      continue;
    }
    console.log(`Downloading ${file}...`);
    await download(url, dest);
  }
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
