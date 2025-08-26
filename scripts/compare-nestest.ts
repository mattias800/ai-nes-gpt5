/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { CPUBus } from "@core/bus/memory";
import { CPU6502 } from "@core/cpu/cpu";
import { parseINes } from "@core/cart/ines";
import { NROM } from "@core/cart/mappers/nrom";
import { disasmAt, formatNestestLine } from "@utils/disasm6502";

function getEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.length > 0 ? v : null;
}
function hex2(v: number) { return v.toString(16).toUpperCase().padStart(2, "0"); }
function hex4(v: number) { return v.toString(16).toUpperCase().padStart(4, "0"); }

type LogEntry = { pc: number, a: number, x: number, y: number, p: number, s: number, cyc: number, raw: string };

function parseLog(lines: string[], limit: number): LogEntry[] {
  const out: LogEntry[] = [];
  for (let i = 0; i < lines.length && (limit <= 0 || out.length < limit); i++) {
    const line = lines[i];
    // Example: C000  A9 00     LDA #$00                        A:00 X:00 Y:00 P:24 SP:FD ... CYC:  7
    const m = /^(?<pc>[0-9A-F]{4}).*A:(?<a>[0-9A-F]{2}) X:(?<x>[0-9A-F]{2}) Y:(?<y>[0-9A-F]{2}) P:(?<p>[0-9A-F]{2}) SP:(?<s>[0-9A-F]{2}).*CYC:\s*(?<cyc>\d+)/.exec(line);
    if (!m || !m.groups) continue;
    out.push({
      pc: parseInt(m.groups.pc, 16),
      a: parseInt(m.groups.a, 16),
      x: parseInt(m.groups.x, 16),
      y: parseInt(m.groups.y, 16),
      p: parseInt(m.groups.p, 16),
      s: parseInt(m.groups.s, 16),
      cyc: parseInt(m.groups.cyc, 10),
      raw: line,
    });
  }
  return out;
}

function dumpStack(bus: CPUBus, sp: number): string {
  const base = 0x0100;
  const top = Math.min(0xFF, (sp + 8) & 0xFF);
  const vals: string[] = [];
  for (let i = sp + 1; i <= top; i++) {
    const addr = base + (i & 0xFF);
    vals.push(`${hex2(i & 0xFF)}:${hex2(bus.read(addr))}`);
  }
  return vals.join(" ");
}

function printDisasmWindow(bus: CPUBus, pc: number, lines: number): string {
  const out: string[] = [];
  let cur = pc & 0xFFFF;
  for (let i = 0; i < lines; i++) {
    const d = disasmAt((a) => bus.read(a), cur);
    out.push(formatNestestLine(cur, d, { a: 0, x: 0, y: 0, p: 0, s: 0 }, 0));
    cur = (cur + d.len) & 0xFFFF;
  }
  return out.join("\n");
}

async function main() {
  const romPath = getEnv("NESTEST_ROM") || path.resolve("roms/nestest.nes");
  const logPath = getEnv("NESTEST_LOG") || path.resolve("roms/nestest.log");
  const max = parseInt(getEnv("NESTEST_MAX") || "0", 10);
  const start = parseInt(getEnv("NESTEST_START") || "0xC000", 16) & 0xFFFF;
  if (!fs.existsSync(romPath)) { console.error(`Missing ROM: ${romPath}`); process.exit(2); }
  if (!fs.existsSync(logPath)) { console.error(`Missing LOG: ${logPath}`); process.exit(2); }
  const lines = fs.readFileSync(logPath, "utf-8").split(/\r?\n/).filter(Boolean);
  const entries = parseLog(lines, max);
  if (entries.length === 0) { console.error("No parsable lines in log"); process.exit(2); }

  const romBuf = new Uint8Array(fs.readFileSync(romPath));
  const rom = parseINes(romBuf);
  const bus = new CPUBus();
  const mapper = new NROM(rom.prg, rom.chr);
  bus.connectCart((addr) => mapper.cpuRead(addr), (addr, v) => mapper.cpuWrite(addr, v));
  bus.connectIO((_addr) => 0x00, (_addr, _v) => {});
  const cpu = new CPU6502(bus);
  cpu.reset(start);

  const maskB = 0xEF;
  for (let i = 0; i < entries.length; i++) {
    const exp = entries[i];
    // Pre-step state compare
    const gotPC = cpu.state.pc & 0xFFFF;
    const gotA = cpu.state.a & 0xFF;
    const gotX = cpu.state.x & 0xFF;
    const gotY = cpu.state.y & 0xFF;
    const gotP = cpu.state.p & 0xFF;
    const gotS = cpu.state.s & 0xFF;
    const okPre =
      gotPC === exp.pc &&
      gotA === exp.a &&
      gotX === exp.x &&
      gotY === exp.y &&
      ((gotP & maskB) === (exp.p & maskB)) &&
      gotS === exp.s;
    if (!okPre) {
      console.error(`Mismatch before step at line ${i + 1}`);
      console.error(`Expected: PC=${hex4(exp.pc)} A:${hex2(exp.a)} X:${hex2(exp.x)} Y:${hex2(exp.y)} P:${hex2(exp.p)} SP:${hex2(exp.s)} CYC:${exp.cyc}`);
      console.error(`Got:      PC=${hex4(gotPC)} A:${hex2(gotA)} X:${hex2(gotX)} Y:${hex2(gotY)} P:${hex2(gotP)} SP:${hex2(gotS)} CYC:${cpu.state.cycles}`);
      console.error("\nDisasm window (from expected PC):");
      console.error(printDisasmWindow(bus, exp.pc, 8));
      console.error("\nRecent PCs:");
      console.error(cpu.getRecentPCs(16).map(hex4).join(" "));
      console.error("\nStack (SP+1..):");
      console.error(dumpStack(bus, gotS));
      process.exit(1);
    }
    const cycBefore = cpu.state.cycles;
    cpu.step();
    if (i + 1 < entries.length) {
      const nextCyc = entries[i + 1].cyc;
      const deltaExp = nextCyc - exp.cyc;
      const deltaGot = cpu.state.cycles - cycBefore;
      if (deltaExp !== deltaGot) {
        console.error(`Cycle delta mismatch after line ${i + 1} at PC=${hex4(exp.pc)} (${lines[i]})`);
        console.error(`Expected delta=${deltaExp}, got ${deltaGot} (CYC before=${exp.cyc}, after=${cpu.state.cycles})`);
        console.error("\nDisasm window (from expected PC):");
        console.error(printDisasmWindow(bus, exp.pc, 8));
        console.error("\nRecent PCs:");
        console.error(cpu.getRecentPCs(16).map(hex4).join(" "));
        process.exit(1);
      }
    }
  }
  console.log(`OK: matched ${entries.length} lines`);
}

main().catch((e) => { console.error(e); process.exit(1); });

