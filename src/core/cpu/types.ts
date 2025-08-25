export type Byte = number; // 0..255
export type Word = number; // 0..65535

export interface CPUState {
  a: Byte;
  x: Byte;
  y: Byte;
  s: Byte; // stack pointer
  pc: Word; // program counter
  p: Byte; // status flags NV-BDIZC (with decimal ignored on RP2A03)
  cycles: number;
}
