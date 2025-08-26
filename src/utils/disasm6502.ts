import type { Byte, Word } from "@core/cpu/types";

export type ReadByteFn = (addr: Word) => Byte;

type AddrMode =
  | "IMP"  // implied
  | "ACC"  // accumulator
  | "IMM"  // #$nn
  | "ZP"   // $nn
  | "ZPX"  // $nn,X
  | "ZPY"  // $nn,Y
  | "ABS"  // $nnnn
  | "ABSX" // $nnnn,X
  | "ABSY" // $nnnn,Y
  | "REL"  // $nnnn (absolute target printed)
  | "IND"  // ($nnnn)
  | "INDX" // ($nn,X)
  | "INDY" // ($nn),Y
  | "UNK";

interface OpInfo {
  mnem: string;
  mode: AddrMode;
  len: 1 | 2 | 3;
}

const T: OpInfo[] = new Array(256).fill(null as any);
function def(op: number, mnem: string, mode: AddrMode, len: 1 | 2 | 3) { T[op] = { mnem, mode, len }; }

// Populate official opcode table (full set)
// 0x00
def(0x00, "BRK", "IMP", 1);
def(0x01, "ORA", "INDX", 2);
def(0x05, "ORA", "ZP", 2);
def(0x06, "ASL", "ZP", 2);
def(0x08, "PHP", "IMP", 1);
def(0x09, "ORA", "IMM", 2);
def(0x0A, "ASL", "ACC", 1);
def(0x0D, "ORA", "ABS", 3);
def(0x0E, "ASL", "ABS", 3);
// 0x10
def(0x10, "BPL", "REL", 2);
def(0x11, "ORA", "INDY", 2);
def(0x15, "ORA", "ZPX", 2);
def(0x16, "ASL", "ZPX", 2);
def(0x18, "CLC", "IMP", 1);
def(0x19, "ORA", "ABSY", 3);
def(0x1D, "ORA", "ABSX", 3);
def(0x1E, "ASL", "ABSX", 3);
// 0x20
def(0x20, "JSR", "ABS", 3);
def(0x21, "AND", "INDX", 2);
def(0x24, "BIT", "ZP", 2);
def(0x25, "AND", "ZP", 2);
def(0x26, "ROL", "ZP", 2);
def(0x28, "PLP", "IMP", 1);
def(0x29, "AND", "IMM", 2);
def(0x2A, "ROL", "ACC", 1);
def(0x2C, "BIT", "ABS", 3);
def(0x2D, "AND", "ABS", 3);
def(0x2E, "ROL", "ABS", 3);
// 0x30
def(0x30, "BMI", "REL", 2);
def(0x31, "AND", "INDY", 2);
def(0x35, "AND", "ZPX", 2);
def(0x36, "ROL", "ZPX", 2);
def(0x38, "SEC", "IMP", 1);
def(0x39, "AND", "ABSY", 3);
def(0x3D, "AND", "ABSX", 3);
def(0x3E, "ROL", "ABSX", 3);
// 0x40
def(0x40, "RTI", "IMP", 1);
def(0x41, "EOR", "INDX", 2);
def(0x45, "EOR", "ZP", 2);
def(0x46, "LSR", "ZP", 2);
def(0x48, "PHA", "IMP", 1);
def(0x49, "EOR", "IMM", 2);
def(0x4A, "LSR", "ACC", 1);
def(0x4C, "JMP", "ABS", 3);
def(0x4D, "EOR", "ABS", 3);
def(0x4E, "LSR", "ABS", 3);
// 0x50
def(0x50, "BVC", "REL", 2);
def(0x51, "EOR", "INDY", 2);
def(0x55, "EOR", "ZPX", 2);
def(0x56, "LSR", "ZPX", 2);
def(0x58, "CLI", "IMP", 1);
def(0x59, "EOR", "ABSY", 3);
def(0x5D, "EOR", "ABSX", 3);
def(0x5E, "LSR", "ABSX", 3);
// 0x60
def(0x60, "RTS", "IMP", 1);
def(0x61, "ADC", "INDX", 2);
def(0x65, "ADC", "ZP", 2);
def(0x66, "ROR", "ZP", 2);
def(0x68, "PLA", "IMP", 1);
def(0x69, "ADC", "IMM", 2);
def(0x6A, "ROR", "ACC", 1);
def(0x6C, "JMP", "IND", 3);
def(0x6D, "ADC", "ABS", 3);
def(0x6E, "ROR", "ABS", 3);
// 0x70
def(0x70, "BVS", "REL", 2);
def(0x71, "ADC", "INDY", 2);
def(0x75, "ADC", "ZPX", 2);
def(0x76, "ROR", "ZPX", 2);
def(0x78, "SEI", "IMP", 1);
def(0x79, "ADC", "ABSY", 3);
def(0x7D, "ADC", "ABSX", 3);
def(0x7E, "ROR", "ABSX", 3);
// 0x80
def(0x81, "STA", "INDX", 2);
def(0x84, "STY", "ZP", 2);
def(0x85, "STA", "ZP", 2);
def(0x86, "STX", "ZP", 2);
def(0x88, "DEY", "IMP", 1);
def(0x8A, "TXA", "IMP", 1);
def(0x8C, "STY", "ABS", 3);
def(0x8D, "STA", "ABS", 3);
def(0x8E, "STX", "ABS", 3);
// 0x90
def(0x90, "BCC", "REL", 2);
def(0x91, "STA", "INDY", 2);
def(0x94, "STY", "ZPX", 2);
def(0x95, "STA", "ZPX", 2);
def(0x96, "STX", "ZPY", 2);
def(0x98, "TYA", "IMP", 1);
def(0x99, "STA", "ABSY", 3);
def(0x9A, "TXS", "IMP", 1);
def(0x9D, "STA", "ABSX", 3);
// 0xA0
def(0xA0, "LDY", "IMM", 2);
def(0xA1, "LDA", "INDX", 2);
def(0xA2, "LDX", "IMM", 2);
def(0xA4, "LDY", "ZP", 2);
def(0xA5, "LDA", "ZP", 2);
def(0xA6, "LDX", "ZP", 2);
def(0xA8, "TAY", "IMP", 1);
def(0xA9, "LDA", "IMM", 2);
def(0xAA, "TAX", "IMP", 1);
def(0xAC, "LDY", "ABS", 3);
def(0xAD, "LDA", "ABS", 3);
def(0xAE, "LDX", "ABS", 3);
// 0xB0
def(0xB0, "BCS", "REL", 2);
def(0xB1, "LDA", "INDY", 2);
def(0xB4, "LDY", "ZPX", 2);
def(0xB5, "LDA", "ZPX", 2);
def(0xB6, "LDX", "ZPY", 2);
def(0xB8, "CLV", "IMP", 1);
def(0xB9, "LDA", "ABSY", 3);
def(0xBA, "TSX", "IMP", 1);
def(0xBC, "LDY", "ABSX", 3);
def(0xBD, "LDA", "ABSX", 3);
def(0xBE, "LDX", "ABSY", 3);
// 0xC0
def(0xC0, "CPY", "IMM", 2);
def(0xC1, "CMP", "INDX", 2);
def(0xC4, "CPY", "ZP", 2);
def(0xC5, "CMP", "ZP", 2);
def(0xC6, "DEC", "ZP", 2);
def(0xC8, "INY", "IMP", 1);
def(0xC9, "CMP", "IMM", 2);
def(0xCA, "DEX", "IMP", 1);
def(0xCC, "CPY", "ABS", 3);
def(0xCD, "CMP", "ABS", 3);
def(0xCE, "DEC", "ABS", 3);
// 0xD0
def(0xD0, "BNE", "REL", 2);
def(0xD1, "CMP", "INDY", 2);
def(0xD5, "CMP", "ZPX", 2);
def(0xD6, "DEC", "ZPX", 2);
def(0xD8, "CLD", "IMP", 1);
def(0xD9, "CMP", "ABSY", 3);
def(0xDD, "CMP", "ABSX", 3);
def(0xDE, "DEC", "ABSX", 3);
// 0xE0
def(0xE0, "CPX", "IMM", 2);
def(0xE1, "SBC", "INDX", 2);
def(0xE4, "CPX", "ZP", 2);
def(0xE5, "SBC", "ZP", 2);
def(0xE6, "INC", "ZP", 2);
def(0xE8, "INX", "IMP", 1);
def(0xE9, "SBC", "IMM", 2);
def(0xEA, "NOP", "IMP", 1);
def(0xEC, "CPX", "ABS", 3);
def(0xED, "SBC", "ABS", 3);
def(0xEE, "INC", "ABS", 3);
// 0xF0
def(0xF0, "BEQ", "REL", 2);
def(0xF1, "SBC", "INDY", 2);
def(0xF5, "SBC", "ZPX", 2);
def(0xF6, "INC", "ZPX", 2);
def(0xF8, "SED", "IMP", 1);
def(0xF9, "SBC", "ABSY", 3);
def(0xFD, "SBC", "ABSX", 3);
def(0xFE, "INC", "ABSX", 3);

// Fallback for unknown
for (let i = 0; i < 256; i++) {
  if (!T[i]) T[i] = { mnem: "???", mode: "UNK", len: 1 };
}

function hex2(v: number) { return v.toString(16).toUpperCase().padStart(2, "0"); }
function hex4(v: number) { return v.toString(16).toUpperCase().padStart(4, "0"); }

export interface DisasmResult {
  bytes: number[];
  mnemonic: string;
  operand: string;
  len: number;
}

export function disasmAt(read: ReadByteFn, pc: Word): DisasmResult {
  const op = read(pc) & 0xFF;
  const info = T[op]!;
  const b1 = read((pc + 1) & 0xFFFF) & 0xFF;
  const b2 = read((pc + 2) & 0xFFFF) & 0xFF;
  const bytes = info.len === 1 ? [op] : info.len === 2 ? [op, b1] : [op, b1, b2];
  const operand = formatOperand(info.mode, pc, b1, b2);
  return { bytes, mnemonic: info.mnem, operand, len: info.len };
}

function formatOperand(mode: AddrMode, pc: Word, b1: Byte, b2: Byte): string {
  switch (mode) {
    case "IMP": return "";
    case "ACC": return "A";
    case "IMM": return "#$" + hex2(b1);
    case "ZP": return "$" + hex2(b1);
    case "ZPX": return "$" + hex2(b1) + ",X";
    case "ZPY": return "$" + hex2(b1) + ",Y";
    case "ABS": return "$" + hex4(b1 | (b2 << 8));
    case "ABSX": return "$" + hex4(b1 | (b2 << 8)) + ",X";
    case "ABSY": return "$" + hex4(b1 | (b2 << 8)) + ",Y";
    case "REL": {
      const off = (b1 < 0x80 ? b1 : b1 - 0x100);
      const target = (pc + 2 + off) & 0xFFFF;
      return "$" + hex4(target);
    }
    case "IND": return "($" + hex4(b1 | (b2 << 8)) + ")";
    case "INDX": return "($" + hex2(b1) + ",X)";
    case "INDY": return "($" + hex2(b1) + "),Y";
    default: return "";
  }
}

export function formatNestestLine(pc: Word, res: DisasmResult, regs: { a: Byte, x: Byte, y: Byte, p: Byte, s: Byte }, cycles: number): string {
  const pcStr = hex4(pc);
  const bytesStr = res.bytes.map(b => hex2(b)).join(" ").padEnd(9, " ");
  const dis = (res.mnemonic + (res.operand ? " " + res.operand : "")).trim();
  const left = `${pcStr}  ${bytesStr} ${dis}`;
  const regCol = 48;
  const pad = left.length < regCol ? " ".repeat(regCol - left.length) : " ";
  const cyc = String(cycles).padStart(3, " ");
  return `${left}${pad}A:${hex2(regs.a)} X:${hex2(regs.x)} Y:${hex2(regs.y)} P:${hex2(regs.p)} SP:${hex2(regs.s)} CYC:${cyc}`;
}

