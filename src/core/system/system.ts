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
    this.io = new NesIO(this.ppu, this.bus);
    this.bus.connectIO(this.io.read, this.io.write);
    this.bus.connectCart((a) => this.cart.readCpu(a), (a, v) => this.cart.writeCpu(a, v));
    this.cpu = new CPU6502(this.bus);
    this.io.setCpuCycleHooks(() => this.cpu.state.cycles, (n) => this.cpu.addCycles(n));

    // Attach APU
    this.apu = new APU();
    this.apu.reset();
    this.io.attachAPU(this.apu);
  }

  reset() {
    const vec = this.bus.read(0xfffc) | (this.bus.read(0xfffd) << 8);
    this.cpu.reset(vec);
    this.ppu.reset();
  }

  // Step one instruction, servicing NMI/IRQ based on PPU and mapper state
  stepInstruction() {
    // Deliver NMI from PPU before CPU step if pending
    if (this.ppu.nmiOccurred && this.ppu.nmiOutput) {
      this.cpu.requestNMI();
      this.ppu.nmiOccurred = false; // edge-triggered
    }
    // Deliver mapper IRQs (e.g., MMC3) before CPU step
    const mapper: any = (this.cart as any).mapper;
    if (mapper.irqPending && mapper.irqPending()) {
      this.cpu.requestIRQ();
      mapper.clearIrq && mapper.clearIrq();
    }

    const before = this.cpu.state.cycles;
    this.cpu.step();
    const delta = this.cpu.state.cycles - before;
    // Tick PPU at 3x CPU cycles
    if (delta > 0) {
      this.ppu.tick(delta * 3);
      this.apu.tick(delta);
    }

    // Deliver NMI if VBlank started during PPU tick
    if (this.ppu.nmiOccurred && this.ppu.nmiOutput) {
      this.cpu.requestNMI();
      this.ppu.nmiOccurred = false;
    }
    // Deliver mapper IRQs after PPU tick
    if (mapper.irqPending && mapper.irqPending()) {
      this.cpu.requestIRQ();
      mapper.clearIrq && mapper.clearIrq();
    }
  }
}
