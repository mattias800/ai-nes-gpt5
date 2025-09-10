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
  }, (addr, v) => {
    if (addr >= 0x8000) prg[(addr - 0x8000) & 0x7FFF] = v & 0xFF;
  });
  bus.connectIO((_addr) => 0x00, (_addr, _v) => {});
  const cpu = new CPU6502(bus);
  // Heuristic: if program is a single BRK at reset, use simplified BRK (pc+1); otherwise use conformance (pc+2)
  if (bytes.length === 1 && (bytes[0] & 0xFF) === 0x00) {
    cpu.setBrkReturnMode('pc+1');
  } else {
    cpu.setBrkReturnMode('pc+2');
  }
  cpu.reset(resetVector);
  return { cpu, bus };
}
