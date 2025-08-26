// Minimal APU with frame counter and basic pulse channel length counters for tests
export class APU {
  // External CPU memory read hook for DMC
  private cpuRead: ((addr: number) => number) | null = null;
  // 4-step sequence by default
  private mode5 = false; // false: 4-step, true: 5-step
  private irqInhibit = false;
  private cycles = 0; // CPU cycles accumulated since sequence start
  private stepIndex = 0;
  private irqFlag = false;

  // Pulse channel state (length counters and halt flags)
  private pulse1Length = 0;
  private pulse2Length = 0;
  private pulse1Halt = false; // from $4000 bit5
  private pulse2Halt = false; // from $4004 bit5
  private enableMask = 0; // last value written to $4015 (enable bits)

  // Envelope units (decay and reload)
  private pulse1EnvVolume = 0; // current envelope volume 0..15
  private pulse2EnvVolume = 0;
  private pulse1EnvDivider = 0; // divider counter
  private pulse2EnvDivider = 0;
  private pulse1EnvPeriod = 0; // from $4000 low 4 bits
  private pulse2EnvPeriod = 0;
  private pulse1EnvLoop = false; // $4000 bit5 also controls length-halt/envelope-loop
  private pulse2EnvLoop = false;
  private pulse1EnvStart = false; // envelope start flag
  private pulse2EnvStart = false;
  private pulse1EnvConstant = false; // $4000 bit4 constant volume
  private pulse2EnvConstant = false;

  // Pulse2 timer/sequencer
  private pulse2TimerPeriod = 0; // 11-bit
  private pulse2Timer = 0;
  private pulse2Phase = 0; // 0..7
  private pulse2Duty = 0; // 0..3
  // Pulse2 sweep
  private pulse2SweepEnable = false;
  private pulse2SweepPeriod = 0;
  private pulse2SweepNegate = false;
  private pulse2SweepShift = 0;
  private pulse2SweepDivider = 0;
  private pulse2SweepReload = false;

  // Pulse1 timer/sequencer
  private pulse1TimerPeriod = 0; // 11-bit
  private pulse1Timer = 0;
  private pulse1Phase = 0; // 0..7
  private pulse1Duty = 0; // 0..3
  // Pulse1 sweep
  private pulse1SweepEnable = false;
  private pulse1SweepPeriod = 0;
  private pulse1SweepNegate = false;
  private pulse1SweepShift = 0;
  private pulse1SweepDivider = 0;
  private pulse1SweepReload = false;

  // Triangle channel (linear counter + length + timer/sequencer)
  private triLinear = 0;
  private triLinearReloadVal = 0; // from $4008 low 7 bits
  private triLinearControl = false; // $4008 bit7 (also length counter halt like pulse)
  private triLinearReloadFlag = false;
  private triLength = 0;
  private triTimerPeriod = 0; // 11-bit period from $400A/$400B (low8/high3)
  private triTimer = 0;       // down-counter
  private triPhase = 0;       // 0..31 index into triangle sequence

  // Noise channel (envelope + length + LFSR)
  private noiseLength = 0;
  private noiseHalt = false;
  private noiseEnvConstant = false;
  private noiseEnvPeriod = 0;
  private noiseEnvDivider = 0;
  private noiseEnvVolume = 0;
  private noiseEnvStart = false;
  private noiseMode = false; // false: tap bit1, true: tap bit6
  private noisePeriodIndex = 0; // 0..15
  private noiseShift = 1; // 15-bit LFSR, initialized non-zero
  private noiseTimerPeriod = 0; // CPU cycles per LFSR step from period table
  private noiseTimer = 0;
  private noiseStepCount = 0; // for tests/debug

  // DMC (bit engine): address/length, IRQ/loop control, sample buffer and bit shifter
  private dmcIrqEnabled = false;
  private dmcLoop = false;
  private dmcRateIndex = 0; // 0..15
  private dmcAddressBase = 0xC000;
  private dmcAddress = 0xC000;
  private dmcLengthBase = 0;
  private dmcBytesRemaining = 0;
  private dmcIrqFlag = false;
  private dmcTimerPeriod = 0;
  private dmcTimer = 0;
  private dmcFetchCount = 0; // for tests/debug
  private dmcSampleBuffer = 0; // holds fetched byte
  private dmcSampleBufferFilled = false;
  private dmcShiftReg = 0;
  private dmcBitsRemaining = 0;
  private dmcDac = 0; // 7-bit (0..127), output amplitude

  // Approximate NTSC step edges in CPU cycles (rounded):
  // 4-step: 3729, 7457, 11186, 14916 (with IRQ)
  // 5-step: 3729, 7457, 11186, 14916, 18641 (no IRQ)
  private fourStep = [3729, 7457, 11186, 14916];
  private fiveStep = [3729, 7457, 11186, 14916, 18641];

  // NTSC noise period table in CPU cycles
  private static NOISE_PERIODS = [
    4, 8, 16, 32, 64, 96, 128, 160,
    202, 254, 380, 508, 762, 1016, 2034, 4068,
  ];

  // NTSC DMC rate periods in CPU cycles (standard table)
  private static DMC_PERIODS = [
    428, 380, 340, 320, 286, 254, 226, 214,
    190, 160, 142, 128, 106, 85, 72, 54,
  ];

  // Length counter table (31 valid indexes 0..31)
  private static LENGTH_TABLE = [
    10, 254, 20, 2, 40, 4, 80, 6,
    160, 8, 60, 10, 14, 12, 26, 14,
    12, 16, 24, 18, 48, 20, 96, 22,
    192, 24, 72, 26, 16, 28, 32, 30,
  ];

  reset() {
    this.cpuRead = null;
    this.mode5 = false; this.irqInhibit = false; this.cycles = 0; this.stepIndex = 0; this.irqFlag = false;
    this.pulse1Length = 0; this.pulse2Length = 0; this.pulse1Halt = false; this.pulse2Halt = false; this.enableMask = 0;
    this.pulse1EnvVolume = 0; this.pulse2EnvVolume = 0;
    this.pulse1EnvDivider = 0; this.pulse2EnvDivider = 0;
    this.pulse1EnvPeriod = 0; this.pulse2EnvPeriod = 0;
    this.pulse1EnvLoop = false; this.pulse2EnvLoop = false;
    this.pulse1EnvStart = false; this.pulse2EnvStart = false;
    this.pulse1EnvConstant = false; this.pulse2EnvConstant = false;
    this.noiseLength = 0; this.noiseHalt = false; this.noiseEnvConstant = false; this.noiseEnvPeriod = 0; this.noiseEnvDivider = 0; this.noiseEnvVolume = 0; this.noiseEnvStart = false; this.noiseMode = false; this.noisePeriodIndex = 0; this.noiseShift = 1; this.noiseTimerPeriod = APU.NOISE_PERIODS[0]; this.noiseTimer = this.noiseTimerPeriod; this.noiseStepCount = 0;
    this.dmcIrqEnabled = false; this.dmcLoop = false; this.dmcRateIndex = 0; this.dmcAddressBase = 0xC000; this.dmcAddress = 0xC000; this.dmcLengthBase = 0; this.dmcBytesRemaining = 0; this.dmcIrqFlag = false; this.dmcTimerPeriod = APU.DMC_PERIODS[0]; this.dmcTimer = this.dmcTimerPeriod; this.dmcFetchCount = 0; this.dmcSampleBuffer = 0; this.dmcSampleBufferFilled = false; this.dmcShiftReg = 0; this.dmcBitsRemaining = 0; this.dmcDac = 0;
  }

  // Generic register write handler (subset for tests)
  writeRegister(addr: number, value: number) {
    value &= 0xFF;
    switch (addr & 0xFFFF) {
      case 0x4000: // pulse1: duty/env; bit5 = length halt/loop, bit4=constant, low4=envelope period
        this.pulse1Halt = (value & 0x20) !== 0;
        this.pulse1EnvLoop = (value & 0x20) !== 0;
        this.pulse1EnvConstant = (value & 0x10) !== 0;
        this.pulse1EnvPeriod = (value & 0x0F);
        this.pulse1Duty = (value >> 6) & 0x03;
        break;
      case 0x4001: { // pulse1 sweep
        this.pulse1SweepEnable = (value & 0x80) !== 0;
        this.pulse1SweepPeriod = (value >> 4) & 0x07;
        this.pulse1SweepNegate = (value & 0x08) !== 0;
        this.pulse1SweepShift = (value & 0x07);
        this.pulse1SweepReload = true;
        break;
      }
      case 0x4002: // pulse1 timer low
        this.pulse1TimerPeriod = (this.pulse1TimerPeriod & 0x700) | (value & 0xFF);
        break;
      case 0x4003: { // pulse1 length counter load (upper 5 bits) and timer high
        const index = (value >> 3) & 0x1F;
        this.pulse1Length = APU.LENGTH_TABLE[index] | 0; // load regardless of enable; cleared later if disabled
        // Envelope start flag set on write to $4003
        this.pulse1EnvStart = true;
        this.pulse1TimerPeriod = ((value & 0x07) << 8) | (this.pulse1TimerPeriod & 0xFF);
        this.pulse1Timer = this.pulse1TimerPeriod;
        this.pulse1Phase = 0;
        break;
      }
      case 0x4004: // pulse2: duty/env
        this.pulse2Halt = (value & 0x20) !== 0;
        this.pulse2EnvLoop = (value & 0x20) !== 0;
        this.pulse2EnvConstant = (value & 0x10) !== 0;
        this.pulse2EnvPeriod = (value & 0x0F);
        this.pulse2Duty = (value >> 6) & 0x03;
        break;
      case 0x4005: { // pulse2 sweep
        this.pulse2SweepEnable = (value & 0x80) !== 0;
        this.pulse2SweepPeriod = (value >> 4) & 0x07;
        this.pulse2SweepNegate = (value & 0x08) !== 0;
        this.pulse2SweepShift = (value & 0x07);
        this.pulse2SweepReload = true;
        break;
      }
      case 0x4006: // pulse2 timer low
        this.pulse2TimerPeriod = (this.pulse2TimerPeriod & 0x700) | (value & 0xFF);
        break;
      case 0x4007: { // pulse2 length counter load and timer high
        const index = (value >> 3) & 0x1F;
        this.pulse2Length = APU.LENGTH_TABLE[index] | 0;
        this.pulse2EnvStart = true;
        this.pulse2TimerPeriod = ((value & 0x07) << 8) | (this.pulse2TimerPeriod & 0xFF);
        this.pulse2Timer = this.pulse2TimerPeriod;
        this.pulse2Phase = 0;
        break;
      }
      case 0x400C: { // noise envelope: bit5 halt/loop, bit4 constant, low4 period
        this.noiseHalt = (value & 0x20) !== 0;
        this.noiseEnvConstant = (value & 0x10) !== 0;
        this.noiseEnvPeriod = value & 0x0F;
        break;
      }
      case 0x400E: { // noise mode/period
        this.noiseMode = (value & 0x80) !== 0;
        this.noisePeriodIndex = value & 0x0F;
        this.noiseTimerPeriod = APU.NOISE_PERIODS[this.noisePeriodIndex & 0x0F];
        this.noiseTimer = this.noiseTimerPeriod;
        break;
      }
      case 0x400F: { // noise length load and envelope start
        const index = (value >> 3) & 0x1F;
        this.noiseLength = APU.LENGTH_TABLE[index] | 0;
        this.noiseEnvStart = true;
        break;
      }
      case 0x4010: { // DMC: IL-- RRRR
        this.dmcIrqEnabled = (value & 0x80) !== 0;
        if (!this.dmcIrqEnabled) this.dmcIrqFlag = false;
        this.dmcLoop = (value & 0x40) !== 0;
        this.dmcRateIndex = value & 0x0F;
        this.dmcTimerPeriod = APU.DMC_PERIODS[this.dmcRateIndex & 0x0F];
        this.dmcTimer = this.dmcTimerPeriod;
        break;
      }
      case 0x4011: { // DMC DAC direct load (7-bit)
        this.dmcDac = value & 0x7F;
        break;
      }
      case 0x4012: { // DMC sample address = $C000 + value*64
        this.dmcAddressBase = 0xC000 + ((value & 0xFF) * 64);
        break;
      }
      case 0x4013: { // DMC sample length = value*16 + 1
        this.dmcLengthBase = ((value & 0xFF) * 16) + 1;
        break;
      }
      case 0x4008: { // triangle linear counter: bit7 control, low7 reload
        this.triLinearControl = (value & 0x80) !== 0;
        this.triLinearReloadVal = value & 0x7F;
        break;
      }
      case 0x400A: { // triangle timer low
        this.triTimerPeriod = (this.triTimerPeriod & 0x700) | (value & 0xFF);
        break;
      }
      case 0x400B: { // triangle length counter load and timer high (3 bits)
        const index = (value >> 3) & 0x1F;
        this.triLength = APU.LENGTH_TABLE[index] | 0;
        this.triTimerPeriod = ((value & 0x07) << 8) | (this.triTimerPeriod & 0xFF);
        this.triLinearReloadFlag = true;
        this.triTimer = this.triTimerPeriod; // Typical behavior reloads on write to high
        this.triPhase = 0; // reset phase for determinism in tests
        break;
      }
      case 0x4015: // status / enable
        this.write4015(value);
        break;
      case 0x4017: // frame counter
        this.write4017(value);
        break;
      default:
        // Ignore other APU regs for now
        break;
    }
  }

  write4017(value: number) {
    this.mode5 = (value & 0x80) !== 0;
    this.irqInhibit = (value & 0x40) !== 0;
    // Writing to $4017 resets the frame counter immediately and optionally clocks a step in 5-step mode
    this.cycles = 0;
    this.stepIndex = 0;
    this.irqFlag = false;
    // Immediate clocking when switching to 5-step mode: clock quarter and half frame units now
    if (this.mode5) {
      this.clockEnvelopes();
      this.clockTriangleLinear();
      this.clockLengthCounters();
      this.clockSweeps();
    }
  }

  write4015(value: number) {
    value &= 0xFF;
    this.enableMask = value;
    // Clearing a channel disable bit clears its length counter
    if ((value & 0x01) === 0) this.pulse1Length = 0;
    if ((value & 0x02) === 0) this.pulse2Length = 0;
    if ((value & 0x04) === 0) this.triLength = 0;
    if ((value & 0x08) === 0) this.noiseLength = 0;
    // DMC enable (bit4)
    if (value & 0x10) {
      if (this.dmcBytesRemaining === 0) {
        this.dmcAddress = this.dmcAddressBase;
        this.dmcBytesRemaining = this.dmcLengthBase;
      }
    } else {
      this.dmcBytesRemaining = 0;
      this.dmcSampleBufferFilled = false;
      this.dmcBitsRemaining = 0;
    }
  }

  read4015(): number {
    // Bit0..3 reflect whether each length counter > 0 (only pulse1/2 modeled here)
    let v = 0;
    if (this.pulse1Length > 0) v |= 0x01;
    if (this.pulse2Length > 0) v |= 0x02;
    if (this.triLength > 0) v |= 0x04;
    if (this.noiseLength > 0) v |= 0x08;
    // Bit6: frame IRQ flag
    if (this.irqFlag) v |= 0x40;
    // Bit7: DMC IRQ flag
    if (this.dmcIrqFlag) v |= 0x80;
    // Reading clears IRQ flags
    this.irqFlag = false;
    this.dmcIrqFlag = false;
    return v & 0xFF;
  }

  tick(cpuCycles: number) {
    const seq = this.mode5 ? this.fiveStep : this.fourStep;
    // Advance triangle timer at CPU cycle granularity
    for (let i = 0; i < cpuCycles; i++) {
      this.clockTriangleTimer();
      this.clockPulse1Timer();
      this.clockNoisePeriod();
      this.clockPulse2Timer();
      this.clockDmcRate();
      this.cycles++;
      while (this.stepIndex < seq.length && this.cycles >= seq[this.stepIndex]) {
        const idx = this.stepIndex;
        // Quarter-frame clocks (envelope/linear) occur at every step index
        this.clockEnvelopes();
        this.clockTriangleLinear();
        // Half-frame clocks (length, sweep): for 4-step, at steps 1 and 3; for 5-step, at steps 1 and 4
        if (!this.mode5) {
          if (idx === 1 || idx === 3) { this.clockLengthCounters(); this.clockSweeps(); }
        } else {
          if (idx === 1 || idx === 4) { this.clockLengthCounters(); this.clockSweeps(); }
        }

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

  private clockLengthCounters() {
    // Decrement length counters if non-zero and not halted. Clearing enable bits already forces zero.
    if (this.pulse1Length > 0 && !this.pulse1Halt && (this.enableMask & 0x01)) this.pulse1Length--;
    if (this.pulse2Length > 0 && !this.pulse2Halt && (this.enableMask & 0x02)) this.pulse2Length--;
    if (this.triLength > 0 && !this.triLinearControl && (this.enableMask & 0x04)) this.triLength--; // control bit halts length
    if (this.noiseLength > 0 && !this.noiseHalt && (this.enableMask & 0x08)) this.noiseLength--;
  }

  private clockTriangleLinear() {
    if (this.triLinearReloadFlag) {
      this.triLinear = this.triLinearReloadVal;
    } else if (this.triLinear > 0) {
      this.triLinear--;
    }
    if (!this.triLinearControl) {
      this.triLinearReloadFlag = false;
    }
  }

  private triangleEnabled(): boolean {
    return (this.enableMask & 0x04) !== 0;
  }

  private clockTriangleTimer() {
    // Triangle advances when enabled and both length and linear counters are non-zero, and timer >= 2
    if (!this.triangleEnabled() || this.triLength === 0 || this.triLinear === 0) return;
    if (this.triTimer === 0) {
      // Periods less than 2 silence the triangle; don't advance
      if (this.triTimerPeriod <= 1) return;
      this.triTimer = this.triTimerPeriod;
      this.triPhase = (this.triPhase + 1) & 0x1F; // 0..31 wrap
    } else {
      this.triTimer--;
    }
  }

  private clockEnvelopes() {
    // Envelope start reloads the divider and volume to 15
    if (this.pulse1EnvStart) {
      this.pulse1EnvStart = false;
      this.pulse1EnvDivider = (this.pulse1EnvPeriod + 1) & 0x1F;
      this.pulse1EnvVolume = 15;
    } else {
      // Constant volume: hold internal volume at 15 in this simplified model
      if (!this.pulse1EnvConstant) {
        if (this.pulse1EnvDivider > 0) {
          this.pulse1EnvDivider--;
        }
        if (this.pulse1EnvDivider === 0) {
          this.pulse1EnvDivider = (this.pulse1EnvPeriod + 1) & 0x1F;
          if (this.pulse1EnvVolume > 0) {
            this.pulse1EnvVolume--;
          } else if (this.pulse1EnvLoop) {
            this.pulse1EnvVolume = 15;
          }
        }
      }
    }

    if (this.pulse2EnvStart) {
      this.pulse2EnvStart = false;
      this.pulse2EnvDivider = (this.pulse2EnvPeriod + 1) & 0x1F;
      this.pulse2EnvVolume = 15;
    } else {
      if (!this.pulse2EnvConstant) {
        if (this.pulse2EnvDivider > 0) {
          this.pulse2EnvDivider--;
        }
        if (this.pulse2EnvDivider === 0) {
          this.pulse2EnvDivider = (this.pulse2EnvPeriod + 1) & 0x1F;
          if (this.pulse2EnvVolume > 0) {
            this.pulse2EnvVolume--;
          } else if (this.pulse2EnvLoop) {
            this.pulse2EnvVolume = 15;
          }
        }
      }
    }

    // Noise envelope
    if (this.noiseEnvStart) {
      this.noiseEnvStart = false;
      this.noiseEnvDivider = (this.noiseEnvPeriod + 1) & 0x1F;
      this.noiseEnvVolume = 15;
    } else {
      if (!this.noiseEnvConstant) {
        if (this.noiseEnvDivider > 0) this.noiseEnvDivider--;
        if (this.noiseEnvDivider === 0) {
          this.noiseEnvDivider = (this.noiseEnvPeriod + 1) & 0x1F;
          if (this.noiseEnvVolume > 0) this.noiseEnvVolume--;
          else if (this.noiseHalt) this.noiseEnvVolume = 15; // loop when halt flag set
        }
      }
    }
  }

  // Expose a timer tick for noise (for tests); on hardware this is driven by a period table.
  private clockNoiseTimer() {
    const bit0 = this.noiseShift & 1;
    const tap = this.noiseMode ? ((this.noiseShift >> 6) & 1) : ((this.noiseShift >> 1) & 1);
    const feedback = (bit0 ^ tap) & 1;
    this.noiseShift = (this.noiseShift >>> 1) | (feedback << 14);
    this.noiseStepCount++;
  }

  private noiseEnabled(): boolean {
    return (this.enableMask & 0x08) !== 0;
  }

  private clockNoisePeriod() {
    if (!this.noiseEnabled() || this.noiseLength === 0) return;
    if (this.noiseTimer === 0) {
      this.noiseTimer = this.noiseTimerPeriod;
      this.clockNoiseTimer();
    } else {
      this.noiseTimer--;
    }
  }

  // Expose a byte clock for DMC in tests (simulates fetching one sample byte)
  private dmcFetchNextByte() {
    if (!this.cpuRead) return;
    // Fetch the next byte into sample buffer if we have remaining bytes and buffer is empty
    if (this.dmcBytesRemaining > 0 && !this.dmcSampleBufferFilled) {
      const byte = this.cpuRead(this.dmcAddress & 0xFFFF) & 0xFF;
      this.dmcAddress = (this.dmcAddress + 1) & 0xFFFF;
      this.dmcBytesRemaining--;
      this.dmcFetchCount++;
      this.dmcSampleBuffer = byte;
      this.dmcSampleBufferFilled = true;
      if (this.dmcBytesRemaining === 0) {
        if (this.dmcLoop) {
          this.dmcAddress = this.dmcAddressBase;
          this.dmcBytesRemaining = this.dmcLengthBase;
        } else if (this.dmcIrqEnabled) {
          this.dmcIrqFlag = true;
        }
      }
    }
  }

  // Backwards-compat test hook: simulate a single DMC byte fetch completion (ignores sample buffer)
  private clockDmcByte() {
    if (this.dmcBytesRemaining > 0) {
      this.dmcAddress = (this.dmcAddress + 1) & 0xFFFF;
      this.dmcBytesRemaining--;
      this.dmcFetchCount++;
      if (this.dmcBytesRemaining === 0) {
        if (this.dmcLoop) {
          this.dmcAddress = this.dmcAddressBase;
          this.dmcBytesRemaining = this.dmcLengthBase;
        } else if (this.dmcIrqEnabled) {
          this.dmcIrqFlag = true;
        }
      }
    }
  }

  private clockDmcRate() {
    if (this.dmcBytesRemaining === 0 && !this.dmcSampleBufferFilled && this.dmcBitsRemaining === 0) return;
    if (this.dmcTimer === 0) {
      this.dmcTimer = this.dmcTimerPeriod;
      // Bit engine step: if no bits remaining, try to load from sample buffer
      if (this.dmcBitsRemaining === 0) {
        // Attempt to fill buffer from memory
        if (!this.dmcSampleBufferFilled) this.dmcFetchNextByte();
        if (this.dmcSampleBufferFilled) {
          this.dmcShiftReg = this.dmcSampleBuffer;
          this.dmcSampleBufferFilled = false;
          this.dmcBitsRemaining = 8;
        } else {
          // No data to play, output holds, nothing to shift
        }
      } else {
        // Process one bit: LSB first
        const bit = this.dmcShiftReg & 1;
        if (bit) {
          if (this.dmcDac <= 125) this.dmcDac += 2; // clamp to 127
          else this.dmcDac = 127;
        } else {
          if (this.dmcDac >= 2) this.dmcDac -= 2;
          else this.dmcDac = 0;
        }
        this.dmcShiftReg = this.dmcShiftReg >>> 1;
        this.dmcBitsRemaining--;
        // If bits become zero, attempt to prefetch next byte for continuous playback
        if (this.dmcBitsRemaining === 0 && this.dmcBytesRemaining > 0 && !this.dmcSampleBufferFilled) {
          this.dmcFetchNextByte();
        }
      }
    } else {
      this.dmcTimer--;
    }
  }

  private pulse1Enabled(): boolean { return (this.enableMask & 0x01) !== 0; }
  private pulse2Enabled(): boolean { return (this.enableMask & 0x02) !== 0; }

  private clockSweeps() {
    // Helper to compute and apply sweep for a channel
    const applySweep = (
      timerPeriod: number,
      sweepEnable: boolean,
      sweepPeriod: number,
      sweepNegate: boolean,
      sweepShift: number,
      isPulse1: boolean
    ): number => {
      if (!sweepEnable || sweepShift === 0) return timerPeriod;
      if (timerPeriod < 8) return timerPeriod; // too high pitch, no update
      const delta = (timerPeriod >> sweepShift) & 0x7FF;
      let target = sweepNegate ? (timerPeriod - delta - (isPulse1 ? 1 : 0)) : (timerPeriod + delta);
      if (target < 0) target = 0;
      if (target > 0x7FF) return timerPeriod; // invalid, do not apply
      return target & 0x7FF;
    };

    // Pulse1 sweep divider
    if (this.pulse1SweepReload) {
      this.pulse1SweepDivider = this.pulse1SweepPeriod;
      this.pulse1SweepReload = false;
    } else if (this.pulse1SweepDivider === 0) {
      const newPeriod = applySweep(
        this.pulse1TimerPeriod,
        this.pulse1SweepEnable,
        this.pulse1SweepPeriod,
        this.pulse1SweepNegate,
        this.pulse1SweepShift,
        true
      );
      this.pulse1TimerPeriod = newPeriod;
      this.pulse1SweepDivider = this.pulse1SweepPeriod;
    } else {
      this.pulse1SweepDivider = (this.pulse1SweepDivider - 1) & 0x07;
    }

    // Pulse2 sweep divider
    if (this.pulse2SweepReload) {
      this.pulse2SweepDivider = this.pulse2SweepPeriod;
      this.pulse2SweepReload = false;
    } else if (this.pulse2SweepDivider === 0) {
      const newPeriod = applySweep(
        this.pulse2TimerPeriod,
        this.pulse2SweepEnable,
        this.pulse2SweepPeriod,
        this.pulse2SweepNegate,
        this.pulse2SweepShift,
        false
      );
      this.pulse2TimerPeriod = newPeriod;
      this.pulse2SweepDivider = this.pulse2SweepPeriod;
    } else {
      this.pulse2SweepDivider = (this.pulse2SweepDivider - 1) & 0x07;
    }
  }

  private clockPulse1Timer() {
    if (!this.pulse1Enabled() || this.pulse1Length === 0) return;
    if (this.pulse1Timer === 0) {
      if (this.pulse1TimerPeriod <= 7) return; // too high pitch -> silent
      this.pulse1Timer = this.pulse1TimerPeriod;
      this.pulse1Phase = (this.pulse1Phase + 1) & 0x07;
    } else {
      this.pulse1Timer--;
    }
  }

  // --- Minimal mixer ---
  private triangleOutput(): number {
    if (!this.triangleEnabled() || this.triLength === 0 || this.triLinear === 0 || this.triTimerPeriod <= 1) return 0;
    const p = this.triPhase & 0x1F;
    return p < 16 ? (15 - p) : (p - 16);
  }

  private pulse1Output(): number {
    if (!this.pulse1Enabled() || this.pulse1Length === 0 || this.pulse1TimerPeriod <= 7) return 0;
    // Duty sequences (NES): indexed by duty, then phase 0..7
    const DUTY: number[][] = [
      [0,1,0,0,0,0,0,0], // 12.5%
      [0,1,1,0,0,0,0,0], // 25%
      [0,1,1,1,1,0,0,0], // 50%
      [1,0,0,1,1,1,1,1], // 75%
    ];
    const bit = DUTY[this.pulse1Duty & 3][this.pulse1Phase & 7];
    if (bit === 0) return 0;
    // Volume: constant or envelope volume
    const vol = this.pulse1EnvConstant ? (this.pulse1EnvPeriod & 0x0F) : (this.pulse1EnvVolume & 0x0F);
    return vol & 0x0F;
  }

  private pulse2Output(): number {
    if (!this.pulse2Enabled() || this.pulse2Length === 0 || this.pulse2TimerPeriod <= 7) return 0;
    const DUTY: number[][] = [
      [0,1,0,0,0,0,0,0],
      [0,1,1,0,0,0,0,0],
      [0,1,1,1,1,0,0,0],
      [1,0,0,1,1,1,1,1],
    ];
    const bit = DUTY[this.pulse2Duty & 3][this.pulse2Phase & 7];
    if (bit === 0) return 0;
    const vol = this.pulse2EnvConstant ? (this.pulse2EnvPeriod & 0x0F) : (this.pulse2EnvVolume & 0x0F);
    return vol & 0x0F;
  }

  private clockPulse2Timer() {
    if (!this.pulse2Enabled() || this.pulse2Length === 0) return;
    if (this.pulse2Timer === 0) {
      if (this.pulse2TimerPeriod <= 7) return;
      this.pulse2Timer = this.pulse2TimerPeriod;
      this.pulse2Phase = (this.pulse2Phase + 1) & 0x07;
    } else {
      this.pulse2Timer--;
    }
  }

  private noiseOutput(): number {
    if (!this.noiseEnabled() || this.noiseLength === 0) return 0;
    const bit0 = this.noiseShift & 1;
    const vol = this.noiseEnvConstant ? (this.noiseEnvPeriod & 0x0F) : (this.noiseEnvVolume & 0x0F);
    return bit0 ? vol : 0;
  }

  // Return a simple 8-bit mixed sample (0..255). Mix triangle + pulse1 + pulse2 + noise + DMC.
  public mixSample(): number {
    const tri = this.triangleOutput(); // 0..15
    const p1 = this.pulse1Output();    // 0..15
    const p2 = this.pulse2Output();    // 0..15
    const noi = this.noiseOutput();    // 0..15
    const dmc = this.dmcDac;           // 0..127
    // Weighting: triangle*10 + pulses*12 each + noise*8 + dmc scaled to roughly match
    let s = tri * 10 + p1 * 12 + p2 * 12 + noi * 8 + Math.floor(dmc * 1.5);
    if (s > 255) s = 255;
    return s & 0xFF;
  }

  // Non-clearing peek for DMC IRQ line (used by system to request CPU IRQ)
  public dmcIrqPending(): boolean { return this.dmcIrqFlag; }
  public frameIrqPending(): boolean { return this.irqFlag && !this.irqInhibit; }
  public setCpuRead(fn: (addr: number) => number) { this.cpuRead = fn; }
}
