import { CPUBus } from '@core/bus/memory';
import { CPU6502 } from '@core/cpu/cpu';

export function cpuWithProgram(bytes: number[], resetVector = 0x8000) {
  // Map a minimal NROM-like cart region where $8000.. is readable program ROM
  const bus = new CPUBus();
  const prg = new Uint8Array(0x8000);
  prg.set(bytes, 0);
  bus.connectCart((addr) => {
    if (addr >= 0x8000) return prg[(addr - 0x8000) & 0x7FFF];
    return 0x00;
  }, (_addr, _v) => {});
  bus.connectIO((_addr) => 0x00, (_addr, _v) => {});
  const cpu = new CPU6502(bus);
  cpu.reset(resetVector);
  return { cpu, bus };
}
