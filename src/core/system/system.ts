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
    if (mapper.setMirrorCallback) mapper.setMirrorCallback((mode: 'horizontal' | 'vertical') => this.ppu.setMirroring(mode));
    if (mapper.setTimeProvider) mapper.setTimeProvider(() => ({ frame: this.ppu.frame, scanline: this.ppu.scanline, cycle: this.ppu.cycle }));
    if (mapper.setCtrlProvider) mapper.setCtrlProvider(() => {
      // Provide an 'effective' ctrl for mapper telemetry that reflects which plane would drive $1000 pulses
      const ctrl = ((this.ppu as any).getCtrlLine ? (this.ppu as any).getCtrlLine() : this.ppu.ctrl) & 0xFF;
      const mask = this.ppu.mask & 0xFF;
      const spUses1000 = (ctrl & 0x08) !== 0;
      const bgUses1000 = (ctrl & 0x10) !== 0;
      const spOn = (mask & 0x10) !== 0;
      const bgOn = (mask & 0x08) !== 0;
      let eff = ctrl & 0x18;
      // If neither plane is configured for $1000 but BG-only is enabled, treat as BG@$1000 for classification purposes
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
    this.apu.reset();
    this.io.attachAPU(this.apu);
    // Provide APU with CPU memory read for DMC fetches
    this.apu.setCpuRead((addr) => this.bus.read(addr & 0xFFFF));
  }

  reset() {
    const vec = this.bus.read(0xfffc) | (this.bus.read(0xfffd) << 8);
    this.cpu.reset(vec);
    this.ppu.reset();
    this.cart.reset();
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
    } catch {}
    this.cpu.setIrqLine(irqLine);

    // Install per-cycle hook so bus-access cycles are interleaved with PPU/APU
    this.cpu.setCycleHook((cycles: number) => {
      if (cycles <= 0) return;
      // Aggregate ticks for efficiency
      this.ppu.tick(cycles * 3);
      this.apu.tick(cycles);
    });

    // Execute one CPU instruction; all cycles (bus + internal) will tick PPU/APU via the per-cycle hook.
    this.cpu.step();

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
    } catch {}
    this.cpu.setIrqLine(irqLine);
  }
}
