import { CPUBus } from '@core/bus/memory';
import { CPU6502 } from '@core/cpu/cpu';
import { NROM } from '@core/cart/mappers/nrom';
import { parseINes } from '@core/cart/ines';
import { Cartridge } from '@core/cart/cartridge';

export interface RunResult {
  cycles: number;
  reason: 'pass' | 'fail' | 'timeout';
  message?: string;
}

export function runINes(buffer: Uint8Array, opts: { maxCycles: number; resetVector?: number }): RunResult {
  const rom = parseINes(buffer);
  const bus = new CPUBus();
  const cart = new Cartridge(rom);
  bus.connectCart((addr) => cart.readCpu(addr), (addr, v) => cart.writeCpu(addr, v));
  bus.connectIO((_addr) => 0x00, (_addr, _v) => {});

  const cpu = new CPU6502(bus);
  const resetVector = opts.resetVector ?? (bus.read(0xFFFC) | (bus.read(0xFFFD) << 8));
  cpu.reset(resetVector);

  while (cpu.state.cycles < opts.maxCycles) {
    try {
      cpu.step();
    } catch (e) {
      return { cycles: cpu.state.cycles, reason: 'fail', message: (e as Error).message };
    }
  }
  return { cycles: cpu.state.cycles, reason: 'timeout' };
}
