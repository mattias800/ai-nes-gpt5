export type Button = 'A'|'B'|'Select'|'Start'|'Up'|'Down'|'Left'|'Right';

// NES controller: $4016 (port 1) and $4017 (port 2)
// Write to $4016 bit0: 1 = strobe (latch current buttons continuously), 0 = shifting enabled
// Read from $4016/$4017 returns bit0 of shift register (A first), then shifts right each read.
// Upper bits typically return 1 on bit6; we'll set bit6 as 1 to emulate open bus behavior.
export class Controller {
  private strobe = 0; // bit0
  private latched = 0; // current latched buttons
  private shift = 0; // read pointer data

  // Order: A, B, Select, Start, Up, Down, Left, Right (LSB first)
  private static order: Button[] = ['A','B','Select','Start','Up','Down','Left','Right'];
  private pressed: Record<Button, boolean> = {
    A:false,B:false,Select:false,Start:false,Up:false,Down:false,Left:false,Right:false,
  };

  setButton(btn: Button, down: boolean) {
    this.pressed[btn] = down;
    if (this.strobe & 1) this.latchButtons();
  }

  write4016(value: number) {
    const newStrobe = value & 1;
    if ((this.strobe & 1) === 1 && newStrobe === 0) {
      // Transition 1->0 latches state for shifting
      this.latchButtons();
    }
    this.strobe = newStrobe;
    if (newStrobe === 1) this.latchButtons();
  }

  read(): number {
    let bit = 1; // default 1 when beyond last bit
    if ((this.strobe & 1) === 1) {
      // While strobe=1, always return current A state
      bit = this.pressed['A'] ? 1 : 0;
    } else {
      bit = this.shift & 1;
      this.shift = (this.shift >>> 1) | 0x80; // after 8 reads, continue returning 1s
    }
    return 0x40 | bit; // bit6 set
  }

  private latchButtons() {
    let v = 0;
    for (let i = 0; i < Controller.order.length; i++) {
      if (this.pressed[Controller.order[i]]) v |= (1 << i);
    }
    this.latched = v;
    this.shift = v;
  }
}
