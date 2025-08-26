// Debug script to investigate SMB3 red clouds issue
import fs from 'node:fs';
import { NESSystem } from './src/core/system/system.js';
import { parseINes } from './src/core/cart/ines.js';

function findSMB3() {
  const files = fs.readdirSync('.').filter(f => f.toLowerCase().includes('mario3') || f.toLowerCase().includes('smb3'));
  return files.length > 0 ? files[0] : null;
}

async function debugSMB3() {
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

  // Enable rendering
  sys.io.write(0x2001, 0x1E);

  // Set VT timing
  if (sys.ppu.setTimingMode) {
    sys.ppu.setTimingMode('vt');
  }

  // Run for a few frames to see what happens
  const frames = 60;
  console.log(`Running for ${frames} frames...`);

  for (let i = 0; i < frames; i++) {
    // Run one frame worth of cycles
    const targetCycles = sys.cpu.state.cycles + Math.floor(1789773 / 60);
    while (sys.cpu.state.cycles < targetCycles) {
      sys.stepInstruction();
    }

    if (i % 10 === 0) {
      console.log(`Frame ${i}: PPU frame=${sys.ppu.frame}, scanline=${sys.ppu.scanline}, cycle=${sys.ppu.cycle}`);
    }
  }

  // Check framebuffer
  const fb = sys.ppu.getFrameBuffer();
  const nonZeroPixels = fb.filter(p => p > 0).length;
  console.log(`Non-zero pixels in framebuffer: ${nonZeroPixels} out of ${fb.length}`);

  // Check if we see red clouds (palette index 0x16 is often red)
  const redPixels = fb.filter(p => p === 0x16).length;
  console.log(`Red pixels (palette 0x16): ${redPixels}`);

  console.log('Debug complete.');
}

debugSMB3().catch(console.error);
