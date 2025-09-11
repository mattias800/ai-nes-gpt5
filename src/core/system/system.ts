import { CPUBus } from '@core/bus/memory';
import { CPU6502 } from '@core/cpu/cpu';
import { PPU } from '@core/ppu/ppu';
import { NesIO } from '@core/io/nesio';
import { Cartridge } from '@core/cart/cartridge';
import type { INesRom } from '@core/cart/ines';
import { APU } from '@core/apu/apu';

export class NESSystem {
  public bus: CPUBus;
  public cpu: CPU6502;
  public ppu: PPU;
  public io: NesIO;
  public cart: Cartridge;
  public apu: APU;
  private _lastIrqLine = false;

  constructor(rom: INesRom) {
    this.bus = new CPUBus();
    this.cart = new Cartridge(rom);
    this.ppu = new PPU();
    this.ppu.connectCHR((a) => this.cart.readChr(a), (a, v) => this.cart.writeChr(a, v));
    const mapper: any = (this.cart as any).mapper;
    if (mapper.notifyA12Rise) this.ppu.setA12Hook(() => mapper.notifyA12Rise());
    // Set mirroring from iNES flags
    const flags6 = (this as any).cart ? (this as any).cart['rom'].flags6 : 0;
    const four = (flags6 & 0x08) !== 0; const vert = (flags6 & 0x01) !== 0;
    if (four) this.ppu.setMirroring('four'); else this.ppu.setMirroring(vert ? 'vertical' : 'horizontal');
    // Allow mapper (e.g., MMC3) to control nametable mirroring dynamically via A000 writes
    if (mapper.setMirrorCallback) mapper.setMirrorCallback((mode: any) => this.ppu.setMirroring(mode));
    if (mapper.setTimeProvider) mapper.setTimeProvider(() => ({ frame: this.ppu.frame, scanline: this.ppu.scanline, cycle: this.ppu.cycle }));
    if (mapper.setCtrlProvider) mapper.setCtrlProvider(() => {
      // Provide an 'effective' ctrl from the start-of-line snapshot (ctrlLine), which matches phase selection.
      const ctrl = ((this.ppu as any).getCtrlLine ? (this.ppu as any).getCtrlLine() : this.ppu.ctrl) & 0xFF;
      const mask = this.ppu.mask & 0xFF;
      const spUses1000 = (ctrl & 0x08) !== 0;
      const bgUses1000 = (ctrl & 0x10) !== 0;
      const spOn = (mask & 0x10) !== 0;
      const bgOn = (mask & 0x08) !== 0;
      let eff = ctrl & 0x18;
      if (!bgUses1000 && !spUses1000) {
        if (bgOn && !spOn) eff |= 0x10;
      }
      return eff & 0xFF;
    });
    this.io = new NesIO(this.ppu, this.bus);
    this.bus.connectIO(this.io.read, this.io.write);
    this.bus.connectCart((a) => this.cart.readCpu(a), (a, v) => this.cart.writeCpu(a, v));
    this.cpu = new CPU6502(this.bus);
    this.io.setCpuCycleHooks(() => this.cpu.state.cycles, (n) => this.cpu.addCycles(n));

    // Attach APU
    this.apu = new APU();
    // Configure region/timing from NES 2.0 if available
    try {
      const timing = (rom as any).timing as ('ntsc'|'pal'|'multi'|'dendy') | undefined;
      const regionPpu = timing ? (timing === 'multi' ? 'ntsc' : timing) : 'ntsc';
      this.ppu.setRegion(regionPpu);
      const regionApu = (timing === 'pal') ? 'PAL' : 'NTSC';
      this.apu.setRegion(regionApu as any);
    } catch {}
    this.apu.reset();
    // Optional: allow fractional APU frame timing via env var (for precise CLI latency/IRQ tests)
    try {
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      const mode = env?.APU_FRAME_TIMING as string | undefined;
      if (mode && typeof (this.apu as any).setFrameTimingMode === 'function') {
        const v = mode.toLowerCase();
        if (v === 'fractional' || v === 'frac' || v === '1') {
          (this.apu as any).setFrameTimingMode('fractional');
        } else if (v === 'integer' || v === 'int' || v === '0') {
          (this.apu as any).setFrameTimingMode('integer');
        }
      }
    } catch {}
    this.io.attachAPU(this.apu);
    // Provide APU with CPU memory read for DMC fetches
    this.apu.setCpuRead((addr) => this.bus.read(addr & 0xFFFF));
    // Provide CPU cycle getter for APU debug timestamps
    try { (this.apu as any).setCpuCycleGetter?.(() => this.cpu.state.cycles); } catch {}
    // Optional: frame phase offset in CPU cycles (may be fractional)
    try {
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      const offStr = env?.APU_FRAME_PHASE_OFFSET_CYCLES as string | undefined;
      if (offStr && (this.apu as any).setFramePhaseOffset) {
        const off = parseFloat(offStr);
        if (isFinite(off)) (this.apu as any).setFramePhaseOffset(off);
      }
      const lagStr = env?.APU_FRAME_IRQ_ASSERT_DELAY as string | undefined;
      if (lagStr && (this.apu as any).setFrameIrqAssertDelay) {
        const lag = parseInt(lagStr, 10) | 0;
        (this.apu as any).setFrameIrqAssertDelay(lag);
      }
    } catch {}
  }

  reset() {
    const vec = this.bus.read(0xfffc) | (this.bus.read(0xfffd) << 8);
    this.cpu.reset(vec);
    this.ppu.reset();
    this.cart.reset();
    this.apu.reset();
    // Reinstall CPU read hook for DMC after APU reset cleared it
    this.apu.setCpuRead((addr) => this.bus.read(addr & 0xFFFF));
  }

  // Perform a CPU-only reset, preserving PPU and mapper state (closer to warm reset semantics)
  cpuResetOnly() {
    const vec = this.bus.read(0xfffc) | (this.bus.read(0xfffd) << 8);
    this.cpu.reset(vec);
    // Intentionally do not reset PPU or Cartridge/mapper
  }

  // Step one instruction, servicing NMI/IRQ based on PPU and mapper state
  stepInstruction() {
    // Deliver NMI from PPU before CPU step if pending
    if (this.ppu.nmiOccurred && this.ppu.nmiOutput) {
      this.cpu.requestNMI();
      this.ppu.nmiOccurred = false; // edge-triggered
    }
    // Compute IRQ line level before CPU step (level-sensitive)
    const mapper: any = (this.cart as any).mapper;
    let irqLine = false;
    if (mapper.irqPending && mapper.irqPending()) irqLine = true;
    try {
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      const disableApuIrq = !!(env && env.DISABLE_APU_IRQ === '1');
      if (!disableApuIrq) {
        if (this.apu && this.apu.dmcIrqPending && this.apu.dmcIrqPending()) irqLine = true;
        if (this.apu && (this.apu as any).frameIrqPending && (this.apu as any).frameIrqPending()) irqLine = true;
      }
      if (env && env.TRACE_IRQ_LINE === '1') {
        const cyc = this.cpu.state.cycles;
        const winStr = env.TRACE_IRQ_LINE_WINDOW as string | undefined;
        let inWin = true;
        if (winStr) {
          const m = /^(\d+)-(\d+)$/.exec(winStr);
          if (m) {
            const a = parseInt(m[1], 10) | 0;
            const b = parseInt(m[2], 10) | 0;
            inWin = cyc >= a && cyc <= b;
          }
        }
        const changeOnly = env.TRACE_IRQ_LINE_CHANGE_ONLY === '1';
        if (inWin && (!changeOnly || (irqLine !== this._lastIrqLine))) {
          const src = {
            mapper: !!(mapper.irqPending && mapper.irqPending()),
            apu_frame: !!(this.apu && (this.apu as any).frameIrqPending && (this.apu as any).frameIrqPending()),
            apu_dmc: !!(this.apu && this.apu.dmcIrqPending && this.apu.dmcIrqPending()),
            I: (this.cpu.state.p & 0x04) !== 0,
            cyc,
            phase: 'pre',
          };
          // eslint-disable-next-line no-console
          console.log(`[irq] ${src.phase} line=${irqLine} I=${src.I} cyc=${src.cyc} mapper=${src.mapper} apu_frame=${src.apu_frame} apu_dmc=${src.apu_dmc}`);
        }
      }
    } catch {}
    this.cpu.setIrqLine(irqLine);
    this._lastIrqLine = irqLine;

    // Install per-cycle hook so bus-access cycles are interleaved with PPU/APU
    this.cpu.setCycleHook((cycles: number) => {
      if (cycles <= 0) return;
      // Aggregate ticks for efficiency
      this.ppu.tick(cycles * 3);
      this.apu.tick(cycles);
      const mapperAny: any = (this.cart as any).mapper;
      if (mapperAny && typeof mapperAny.tick === 'function') mapperAny.tick(cycles);
    });

    // Execute one CPU instruction; all cycles (bus + internal) will tick PPU/APU via the per-cycle hook.
    this.cpu.step();

    // Apply any APU-induced CPU stalls (e.g., DMC DMA fetches) behind an opt-in env flag
    try {
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      const enableDmcStalls = !!(env && env.ENABLE_DMC_STALLS === '1');
      if (enableDmcStalls) {
        const stall = (this.apu as any)?.consumeDmcStallCycles?.() | 0;
        if (stall > 0) {
          this.cpu.addCycles(stall);
          // Keep PPU/APU/mapper in sync during stall
          this.ppu.tick(stall * 3);
          this.apu.tick(stall);
          const mapperAny: any = (this.cart as any).mapper;
          if (mapperAny && typeof mapperAny.tick === 'function') mapperAny.tick(stall);
        }
      }
    } catch {}

    // Deliver NMI if VBlank started during PPU tick
    if (this.ppu.nmiOccurred && this.ppu.nmiOutput) {
      this.cpu.requestNMI();
      this.ppu.nmiOccurred = false;
    }
    // Recompute IRQ line after PPU/APU tick
    irqLine = false;
    if (mapper.irqPending && mapper.irqPending()) irqLine = true;
    try {
      const env = (typeof process !== 'undefined' ? (process as any).env : undefined);
      const disableApuIrq = !!(env && env.DISABLE_APU_IRQ === '1');
      if (!disableApuIrq) {
        if (this.apu && this.apu.dmcIrqPending && this.apu.dmcIrqPending()) irqLine = true;
        if (this.apu && (this.apu as any).frameIrqPending && (this.apu as any).frameIrqPending()) irqLine = true;
      }
      if (env && env.TRACE_IRQ_LINE === '1') {
        const cyc = this.cpu.state.cycles;
        const winStr = env.TRACE_IRQ_LINE_WINDOW as string | undefined;
        let inWin = true;
        if (winStr) {
          const m = /^(\d+)-(\d+)$/.exec(winStr);
          if (m) {
            const a = parseInt(m[1], 10) | 0;
            const b = parseInt(m[2], 10) | 0;
            inWin = cyc >= a && cyc <= b;
          }
        }
        const changeOnly = env.TRACE_IRQ_LINE_CHANGE_ONLY === '1';
        if (inWin && (!changeOnly || (irqLine !== this._lastIrqLine))) {
          const src = {
            mapper: !!(mapper.irqPending && mapper.irqPending()),
            apu_frame: !!(this.apu && (this.apu as any).frameIrqPending && (this.apu as any).frameIrqPending()),
            apu_dmc: !!(this.apu && this.apu.dmcIrqPending && this.apu.dmcIrqPending()),
            I: (this.cpu.state.p & 0x04) !== 0,
            cyc,
            phase: 'post',
          };
          // eslint-disable-next-line no-console
          console.log(`[irq] ${src.phase} line=${irqLine} I=${src.I} cyc=${src.cyc} mapper=${src.mapper} apu_frame=${src.apu_frame} apu_dmc=${src.apu_dmc}`);
        }
      }
    } catch {}
    this.cpu.setIrqLine(irqLine);
    this._lastIrqLine = irqLine;
  }
}
