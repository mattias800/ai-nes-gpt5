import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  // Simple infinite NOP loop at $8000
  prg[0x0000] = 0xEA; prg[0x0001] = 0x4C; prg[0x0002] = 0x00; prg[0x0003] = 0x80;
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

// Generate an audio block by stepping CPU to maintain CPU_HZ/sampleRate cycles per output sample
function generateSamples(sys: NESSystem, frames: number, sampleRate: number, state: { lastCycles: number, targetCycles: number }): Float32Array {
  const CPU_HZ = 1789773;
  const out = new Float32Array(frames);
  const cyclesPerSample = CPU_HZ / sampleRate;
  if (state.lastCycles === 0) {
    state.lastCycles = sys.cpu.state.cycles;
    state.targetCycles = state.lastCycles;
  }
  for (let i = 0; i < frames; i++) {
    state.targetCycles += cyclesPerSample;
    while (sys.cpu.state.cycles < state.targetCycles) sys.stepInstruction();
    out[i] = (((sys.apu.mixSample() | 0) - 128) / 128);
    state.lastCycles = sys.cpu.state.cycles;
  }
  return out;
}

describe('Audio sample generator (host)', () => {
  it('produces non-silent, bounded samples for a simple pulse tone', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Configure pulse1: constant volume, duty 50%, audible timer, enable channel
    sys.io.write(0x4015, 0x01); // enable pulse1
    sys.io.write(0x4000, 0x10 | 0x08 | (2 << 6)); // constant volume=8, duty=50%
    sys.io.write(0x4002, 0x40); // period low
    sys.io.write(0x4003, 0x02); // period high bits, load length

    const state = { lastCycles: 0, targetCycles: 0 };
    const sr = 44100;
    const block = generateSamples(sys, 2048, sr, state);

    // Basic assertions: values in [-1,1], non-constant (non-zero variance), not all zeros
    let min = Infinity, max = -Infinity, sum = 0, sum2 = 0;
    for (let i = 0; i < block.length; i++) {
      const v = block[i];
      if (v < min) min = v; if (v > max) max = v;
      sum += v; sum2 += v * v;
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(1.01);
    }
    const mean = sum / block.length;
    const variance = sum2 / block.length - mean * mean;
    expect(max - min).toBeGreaterThan(0.01);
    expect(variance).toBeGreaterThan(1e-6);
  });
});

