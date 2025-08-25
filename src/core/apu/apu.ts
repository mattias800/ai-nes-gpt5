// Minimal APU frame counter skeleton for deterministic tests
export class APU {
  // 4-step sequence by default
  private mode5 = false; // false: 4-step, true: 5-step
  private irqInhibit = false;
  private cycles = 0; // CPU cycles accumulated
  private stepIndex = 0;
  private irqFlag = false;

  // Approximate NTSC step edges in CPU cycles (rounded):
  // 4-step: 3729, 7457, 11186, 14916 (with IRQ)
  // 5-step: 3729, 7457, 11186, 14916, 18641 (no IRQ)
  private fourStep = [3729, 7457, 11186, 14916];
  private fiveStep = [3729, 7457, 11186, 14916, 18641];

  reset() {
    this.mode5 = false; this.irqInhibit = false; this.cycles = 0; this.stepIndex = 0; this.irqFlag = false;
  }

  write4017(value: number) {
    this.mode5 = (value & 0x80) !== 0;
    this.irqInhibit = (value & 0x40) !== 0;
    // Writing to $4017 resets the frame counter immediately and optionally clocks a step in 5-step mode
    this.cycles = 0;
    this.stepIndex = 0;
    this.irqFlag = false;
  }

  read4015(): number {
    // Bit6: frame IRQ flag
    const v = this.irqFlag ? 0x40 : 0x00;
    this.irqFlag = false; // reading clears flag
    return v;
  }

  tick(cpuCycles: number) {
    const seq = this.mode5 ? this.fiveStep : this.fourStep;
    this.cycles += cpuCycles;
    while (this.stepIndex < seq.length && this.cycles >= seq[this.stepIndex]) {
      this.stepIndex++;
      // On 4-step, at end of sequence, set IRQ if not inhibited
      if (!this.mode5 && this.stepIndex === seq.length) {
        if (!this.irqInhibit) this.irqFlag = true;
        // Wrap sequence
        this.cycles -= seq[seq.length - 1];
        this.stepIndex = 0;
      }
      // On 5-step, wrap at end with no IRQ
      if (this.mode5 && this.stepIndex === seq.length) {
        this.cycles -= seq[seq.length - 1];
        this.stepIndex = 0;
      }
    }
  }
}
