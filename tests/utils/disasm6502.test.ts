import { describe, it, expect } from "vitest";
import { disasmAt, formatNestestLine } from "@utils/disasm6502";

function makeReaderAt(basePc: number, bytes: number[]) {
  return (addr: number) => {
    const idx = (addr - (basePc & 0xFFFF)) & 0xFFFF;
    if (idx >= 0 && idx < bytes.length) return bytes[idx];
    return 0x00;
  };
}

describe("disasm6502 formatting", () => {
  it("formats LDA #$01", () => {
    const read = makeReaderAt(0xC000, [0xA9, 0x01]);
    const d = disasmAt(read, 0xC000);
    expect(d.mnemonic).toBe("LDA");
    expect(d.operand).toBe("#$01");
    const line = formatNestestLine(0xC000, d, { a: 0, x: 0, y: 0, p: 0x24, s: 0xFD }, 7);
    expect(line.startsWith("C000  A9 01     LDA #$01")).toBe(true);
  });
  it("formats branch target absolute", () => {
    const read = makeReaderAt(0xC002, [0xD0, 0xFE]); // BNE back -2 -> C000
    const d = disasmAt(read, 0xC002);
    expect(d.mnemonic).toBe("BNE");
    expect(d.operand).toBe("$C002"); // pc+2 + (-2) = C002
  });
});

