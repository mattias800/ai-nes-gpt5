// Debug script to investigate SMB3 red clouds issue
import fs from 'node:fs';
import { NESSystem } from './src/core/system/system.js';
import { parseINes } from './src/core/cart/ines.js';

function findROM(name: string) {
  const files = fs.readdirSync('.').filter(f =>
    f.endsWith('.nes') && f.toLowerCase().includes(name)
  );
  return files.length > 0 ? files[0] : null;
}

async function testROM(name: string, romPath: string) {
  console.log(`\n=== Testing ${name} ===`);
  console.log(`Loading ${romPath}...`);
  const romData = new Uint8Array(fs.readFileSync(romPath));
  const rom = parseINes(romData);
  console.log(`Mapper: ${rom.mapper}`);

  const sys = new NESSystem(rom);
  sys.reset();

  // Enable rendering
  sys.io.write(0x2001, 0x1E);

  // Set VT timing
  if (sys.ppu.setTimingMode) {
    sys.ppu.setTimingMode('vt');
  }

  // Run for more frames to see if it transitions to proper title screen
  const frames = 120;
  let lastBankRegs = [0, 0, 0, 0, 0, 0, 0, 0];

  // Detailed analysis only for SMB3
  if (name === 'SMB3') {
    // Check VRAM state immediately after reset
    const vram = (sys.ppu as any).vram;
    console.log(`VRAM after reset [0x2400-0x240F]: ${Array.from(vram.slice(0x400, 0x410)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

    for (let i = 0; i < frames; i++) {
      const targetCycles = sys.cpu.state.cycles + Math.floor(1789773 / 60);
      while (sys.cpu.state.cycles < targetCycles) {
        sys.stepInstruction();
      }

      // Check VRAM state at key frames
      if (i === 0 || i === 9 || i === 10 || i === 30 || i === 60 || i === 90 || i === 119) {
        const vram = (sys.ppu as any).vram;
        console.log(`Frame ${i} VRAM [0x2400-0x240F]: ${Array.from(vram.slice(0x400, 0x410)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
      }

      // Check if bank registers changed
      const mapper = (sys.cart as any).mapper;
      const bankRegs = (mapper as any).bankRegs;
      const changed = bankRegs.some((reg: number, idx: number) => reg !== lastBankRegs[idx]);

      if (changed) {
        console.log(`Frame ${i}: Bank registers changed to [${bankRegs.join(', ')}]`);
        lastBankRegs = [...bankRegs];
      }
    }
  } else {
    // Simple test for other games
    for (let i = 0; i < frames; i++) {
      const targetCycles = sys.cpu.state.cycles + Math.floor(1789773 / 60);
      while (sys.cpu.state.cycles < targetCycles) {
        sys.stepInstruction();
      }
    }
  }

  // Check framebuffer
  const fb = sys.ppu.getFrameBuffer();
  const nonZeroPixels = fb.filter(p => p > 0).length;
  const redPixels = fb.filter(p => p === 0x16).length;
  console.log(`${name} results:`);
  console.log(`  Non-zero pixels: ${nonZeroPixels} out of ${fb.length}`);
  console.log(`  Red pixels (0x16): ${redPixels}`);

  // For MMC3, check VRAM and nametable state
  if (rom.mapper === 4) {
    const vram = (sys.ppu as any).vram;
    console.log(`  VRAM[0x2400-0x240F]: ${Array.from(vram.slice(0x400, 0x410)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    console.log(`  Palette[0x00-0x0F]: ${Array.from((sys.ppu as any).palette.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  }

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
}

async function debugSMB3() {
  const romPath = findROM('mario3') || findROM('smb3');
  if (!romPath) {
    console.error('SMB3 ROM not found');
    return;
  }

  console.log(`Loading ${romPath}...`);
  const romData = new Uint8Array(fs.readFileSync(romPath));
  const rom = parseINes(romData);
  console.log(`Mapper: ${rom.mapper} (should be 4 for MMC3)`);

  const sys = new NESSystem(rom);
  sys.reset();

  // Enable rendering
  sys.io.write(0x2001, 0x1E);

  // Set VT timing
  if (sys.ppu.setTimingMode) {
    sys.ppu.setTimingMode('vt');
  }

  // Enable MMC3 tracing
  process.env.MMC3_TRACE = '1';
  process.env.PPU_TRACE = '1';

  // Test CHR ROM content and mapping
  const mapper = (sys.cart as any).mapper;
  console.log(`CHR ROM length: ${(mapper as any).chr.length} bytes`);
  console.log(`First 16 bytes of CHR ROM: ${Array.from((mapper as any).chr.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  console.log(`Bank registers: [${(mapper as any).bankRegs.join(', ')}]`);
  console.log(`Bank select: ${(mapper as any).bankSelect.toString(16)}`);

  // Test mapChr function
  const testAddrs = [0x0000, 0x1000, 0x1FF8];
  testAddrs.forEach(addr => {
    const mapped = (mapper as any).mapChr(addr);
    const value = (mapper as any).chr[mapped];
    console.log(`mapChr(0x${addr.toString(16)}) = 0x${mapped.toString(16)} -> 0x${value.toString(16)}`);
  });

  // Test MMC3 directly
  console.log('Testing MMC3 directly...');
  const mmc3Value = mapper.ppuRead(0x1000);
  console.log(`MMC3.ppuRead(0x1000) = ${mmc3Value.toString(16)}`);

  // Test raw CHR ROM access
  console.log(`MMC3 CHR ROM length: ${(mapper as any).chr.length}`);
  console.log(`MMC3 CHR ROM[0x1000]: ${(mapper as any).chr[0x1000].toString(16)}`);

  // Check if CHR ROM has the right data - look for red patterns
  console.log('Looking for red palette indices in CHR ROM...');
  let foundRedPatterns = 0;
  for (let i = 0; i < Math.min(0x2000, (mapper as any).chr.length); i++) {
    if ((mapper as any).chr[i] === 0x16) {
      console.log(`Found 0x16 at CHR[${i.toString(16)}]`);
      foundRedPatterns++;
      if (foundRedPatterns >= 5) break;
    }
  }
  console.log(`Found ${foundRedPatterns} red patterns in first 8KB of CHR ROM`);

  // Test cart CHR access for comparison
  const cartChrValue = sys.cart.readChr(0x1000);
  console.log(`cart.readChr(0x1000) = ${cartChrValue.toString(16)}`);

  // Check if this triggered MMC3 trace
  const traceAfterMMC3 = mapper.getTrace();
  if (traceAfterMMC3.length > 0) {
    console.log(`MMC3 access triggered ${traceAfterMMC3.length} traces`);
    traceAfterMMC3.slice(-3).forEach((entry, idx) => {
      console.log(`    ${JSON.stringify(entry)}`);
    });
  } else {
    console.log('MMC3 access did NOT trigger traces');
  }

  // Run for more frames to see red clouds and MMC3 writes
  const frames = 30;
  console.log(`Running for ${frames} frames...`);

  for (let i = 0; i < frames; i++) {
    const targetCycles = sys.cpu.state.cycles + Math.floor(1789773 / 60);
    while (sys.cpu.state.cycles < targetCycles) {
      sys.stepInstruction();
    }

    console.log(`Frame ${i}: PPU frame=${sys.ppu.frame}, scanline=${sys.ppu.scanline}, cycle=${sys.ppu.cycle}`);
    console.log(`  PPU CTRL=${sys.ppu.ctrl.toString(16)}, MASK=${sys.ppu.mask.toString(16)}`);

    // Check MMC3 trace after each frame
    const trace = mapper.getTrace();
    if (trace.length > 0) {
      console.log(`  MMC3 trace (${trace.length} entries):`);
      trace.slice(-3).forEach((entry, idx) => {
        console.log(`    ${JSON.stringify(entry)}`);
      });
    } else {
      console.log(`  MMC3 trace: empty`);
    }

    // Check bank registers
    const bankRegs = (mapper as any).bankRegs;
    if (bankRegs.some((reg: number) => reg !== 0)) {
      console.log(`  Bank registers changed: [${bankRegs.join(', ')}]`);
    }
  }

  // Check framebuffer
  const fb = sys.ppu.getFrameBuffer();
  const nonZeroPixels = fb.filter(p => p > 0).length;
  console.log(`Non-zero pixels: ${nonZeroPixels} out of ${fb.length}`);

  const redPixels = fb.filter(p => p === 0x16).length;
  console.log(`Red pixels (0x16): ${redPixels}`);

  console.log('Debug complete.');
}

async function compareGames() {
  // Test SMB1 (mario.nes)
  const smb1Path = findROM('mario');
  if (smb1Path) {
    await testROM('SMB1', smb1Path);
  } else {
    console.log('SMB1 ROM not found');
  }

  // Test SMB3
  const smb3Path = findROM('mario3') || findROM('smb3');
  if (smb3Path) {
    await testROM('SMB3', smb3Path);
  } else {
    console.log('SMB3 ROM not found');
  }

  // Test Zelda
  const zeldaPath = findROM('zelda');
  if (zeldaPath) {
    await testROM('Zelda', zeldaPath);
  } else {
    console.log('Zelda ROM not found');
  }
}

compareGames().catch(console.error);