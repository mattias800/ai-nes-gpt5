import { describe, it, expect } from 'vitest';
import { NESSystem } from '@core/system/system';
import type { INesRom } from '@core/cart/ines';

function rom(): INesRom {
  const prg = new Uint8Array(0x8000);
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80;
  return { prg, chr: new Uint8Array(0x2000), mapper: 0, hasTrainer: false, prgRamSize: 8*1024, flags6: 0, flags7: 0 };
}

describe('APU triangle timer/sequencer gating', () => {
  it('advances phase only when enabled and both linear and length are non-zero', () => {
    const sys = new NESSystem(rom());
    sys.reset();

    // Disable triangle initially
    sys.io.write(0x4015, 0x00);

    // Set timer to a small period (>1)
    sys.io.write(0x400A, 0x02); // low=2
    sys.io.write(0x400B, 0x00); // high=0, also loads length and sets linear reload flag

    // Set linear reload to 3, control=0
    sys.io.write(0x4008, 0x03);

    // Snapshot phase
    let snap: any = sys.apu as any;
    const phase0 = snap['triPhase'];

    // With channel disabled, ticking should not advance phase
    sys.apu.tick(1000);
    snap = sys.apu as any;
    expect(snap['triPhase']).toBe(phase0);

    // Enable triangle; quarter-frame will reload linear to 3, then decrements next quarters
    sys.io.write(0x4015, 0x04);
    sys.apu.tick(3729); // quarter-frame -> linear=3

    // Now run several CPU cycles; timer period is 0x002, so it advances at a modest rate
    const phase1 = (sys.apu as any)['triPhase'];
    sys.apu.tick(1000);
    const phase2 = (sys.apu as any)['triPhase'];
    expect(phase2).toBeGreaterThan(phase1);

    // Force linear to zero by waiting enough quarter frames
    sys.apu.tick(3729 * 4);
    const phaseBefore = (sys.apu as any)['triPhase'];
    sys.apu.tick(1000);
    const phaseAfter = (sys.apu as any)['triPhase'];
    expect(phaseAfter).toBe(phaseBefore); // no advance when linear==0

    // Set control=1 and reload linear to 2, then check it advances again
    sys.io.write(0x4008, 0x80 | 0x02);
    sys.io.write(0x400B, 0x00);
    sys.apu.tick(3729);
    const phaseResumeBefore = (sys.apu as any)['triPhase'];
    sys.apu.tick(1000);
    const phaseResumeAfter = (sys.apu as any)['triPhase'];
    expect(phaseResumeAfter).toBeGreaterThan(phaseResumeBefore);

    // Disable triangle -> phase stops
    sys.io.write(0x4015, 0x00);
    const phaseStopBefore = (sys.apu as any)['triPhase'];
    sys.apu.tick(1000);
    const phaseStopAfter = (sys.apu as any)['triPhase'];
    expect(phaseStopAfter).toBe(phaseStopBefore);
  });
});

