/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { CPUBus } from "@core/bus/memory";
import { CPU6502 } from "@core/cpu/cpu";
import { parseINes } from "@core/cart/ines";
import { NROM } from "@core/cart/mappers/nrom";
import { disasmAt, formatNestestLine } from "@utils/disasm6502";

type Args = {
  max: number;
  start: number;
  cyclesOnly: boolean;
  illegal: "strict" | "lenient";
  rom: string;
  seconds: number; // wall-clock seconds limit; 0 = disabled
};

function getEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.length > 0 ? v : null;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let max = parseInt(getEnv("NESTEST_MAX") || "0", 10);
  let start = parseInt(getEnv("NESTEST_START") || "0xC000", 16);
  let cyclesOnly = (getEnv("NESTEST_CYCLES_ONLY") || "0") === "1";
  let illegal: "strict" | "lenient" = (getEnv("NESTEST_ILLEGAL") as any) || "lenient";
  let rom = getEnv("NESTEST_ROM") || path.resolve("roms/nestest.nes");
  let seconds = parseFloat(getEnv("TRACE_SECONDS") || "0");
  for (const a of argv) {
    if (a.startsWith("--max=")) max = parseInt(a.slice(6), 10);
    else if (a.startsWith("--start=")) start = parseInt(a.slice(8), 16);
    else if (a === "--cycles-only") cyclesOnly = true;
    else if (a.startsWith("--illegal=")) illegal = (a.slice(10) as any);
    else if (a.startsWith("--rom=")) rom = a.slice(6);
    else if (a.startsWith("--seconds=")) seconds = parseFloat(a.slice(10));
  }
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  return { max, start, cyclesOnly, illegal, rom, seconds };
}

function hex2(v: number) { return v.toString(16).toUpperCase().padStart(2, "0"); }

async function main() {
  const args = parseArgs();
  if (!fs.existsSync(args.rom)) {
    console.error(`ROM not found: ${args.rom}`);
    process.exit(2);
  }
  const romBuf = new Uint8Array(fs.readFileSync(args.rom));
  const rom = parseINes(romBuf);
  const bus = new CPUBus();
  const mapper = new NROM(rom.prg, rom.chr);
  bus.connectCart((addr) => mapper.cpuRead(addr), (addr, v) => mapper.cpuWrite(addr, v));
  bus.connectIO((_addr) => 0x00, (_addr, _v) => {});

  const cpu = new CPU6502(bus);
  cpu.setIllegalMode(args.illegal);
  cpu.reset(args.start & 0xFFFF);

  const max = args.max > 0 ? args.max : Number.MAX_SAFE_INTEGER;
  const extra = process.env.NESTEST_TRACE_EXTRA === "1";
  if (extra) {
    cpu.setExtraTraceHook(({ pc, opcode, ea, crossed }) => {
      // Lightweight stderr annotation for addressing-mode triage (optional)
      // Example: [EA=$C012 crossed=1]
      // Comment out if too noisy.
      // console.error(`[${pc.toString(16)}] opcode=${hex2(opcode)} EA=${ea != null ? "$" + (ea & 0xFFFF).toString(16) : "null"} crossed=${crossed ? 1 : 0}`);
    });
  }

  const deadline = args.seconds > 0 ? ((typeof performance !== 'undefined' ? performance.now() : Date.now()) + args.seconds * 1000) : Number.POSITIVE_INFINITY;
  let i = 0;
  while (i < max) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now >= deadline) break;
    const pc = cpu.state.pc & 0xFFFF;
    const dis = disasmAt((addr) => bus.read(addr), pc);
    if (args.cyclesOnly) {
      const cyc = String(cpu.state.cycles).padStart(3, " ");
      console.log(`CYC:${cyc}`);
    } else {
      const line = formatNestestLine(pc, dis, { a: cpu.state.a, x: cpu.state.x, y: cpu.state.y, p: cpu.state.p, s: cpu.state.s }, cpu.state.cycles);
      console.log(line);
    }
    cpu.step();
    i++;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
