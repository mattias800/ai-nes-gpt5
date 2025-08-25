import { CPUBus } from '@core/bus/memory';
import { CPU6502 } from '@core/cpu/cpu';
import { PPU } from '@core/ppu/ppu';
import { NesIO } from '@core/io/nesio';
import { Cartridge } from '@core/cart/cartridge';
import type { INesRom } from '@core/cart/ines';

export class NESSystem {
  public bus: CPUBus;
  public cpu: CPU6502;
  public ppu: PPU;
  public io: NesIO;
  public cart: Cartridge;

  constructor(rom: INesRom) {
    this.bus = new CPUBus();
    this.cart = new Cartridge(rom);
    this.ppu = new PPU();
    this.ppu.connectCHR((a) => this.cart.readChr(a), (a, v) => this.cart.writeChr(a, v));
    this.io = new NesIO(this.ppu, this.bus);
    this.bus.connectIO(this.io.read, this.io.write);
    this.bus.connectCart((a) => this.cart.readCpu(a), (a, v) => this.cart.writeCpu(a, v));
    this.cpu = new CPU6502(this.bus);
  }

  reset() {
    const vec = this.bus.read(0xfffc) | (this.bus.read(0xfffd) << 8);
    this.cpu.reset(vec);
    this.ppu.reset();
  }

  // Step one instruction, servicing NMI/IRQ based on PPU and mapper state
  stepInstruction() {
    // Deliver NMI from PPU
    if (this.ppu.nmiOccurred && this.ppu.nmiOutput) {
      this.cpu.requestNMI();
      this.ppu.nmiOccurred = false; // edge-triggered
    }
    // Deliver mapper IRQs (e.g., MMC3)
    const mapper: any = (this.cart as any).mapper;
    if (mapper.irqPending && mapper.irqPending()) {
      this.cpu.requestIRQ();
      mapper.clearIrq && mapper.clearIrq();
    }
    this.cpu.step();
  }
}
