const { CPU6502 } = require('./dist/core/cpu/cpu.js');
const { CPUBus } = require('./dist/core/bus/memory.js');

// Create bus and CPU
const bus = new CPUBus();
const cpu = new CPU6502(bus);

// Set up program: NOP; BRK at $8000
bus.write(0x8000, 0xEA); // NOP
bus.write(0x8001, 0x00); // BRK
// IRQ/BRK vector to $9000
bus.write(0xFFFE, 0x00);
bus.write(0xFFFF, 0x90);
// RTI at $9000
bus.write(0x9000, 0x40);

// Reset CPU to start at $8000
cpu.reset(0x8000);

console.log('Initial state:', `PC=$${cpu.state.pc.toString(16)} P=$${cpu.state.p.toString(16)}`);

// Step NOP
cpu.step();
console.log('After NOP:', `PC=$${cpu.state.pc.toString(16)} P=$${cpu.state.p.toString(16)}`);

// Step BRK
const sBefore = cpu.state.s;
cpu.step();
console.log('After BRK:', `PC=$${cpu.state.pc.toString(16)} P=$${cpu.state.p.toString(16)} S=$${cpu.state.s.toString(16)}`);
const pPushed = bus.read(0x01FB);
console.log('P pushed by BRK:', `$${pPushed.toString(16)} (B=${(pPushed & 0x10) ? 1 : 0})`);

// Step RTI
cpu.step();
console.log('After RTI:', `PC=$${cpu.state.pc.toString(16)} P=$${cpu.state.p.toString(16)} (I=${(cpu.state.p & 0x04) ? 1 : 0})`);

// Place CLI at current PC
const currentPC = cpu.state.pc;
console.log('Placing CLI at:', `$${currentPC.toString(16)}`);
bus.write(currentPC, 0x58); // CLI

// Step CLI
cpu.step();
console.log('After CLI:', `PC=$${cpu.state.pc.toString(16)} P=$${cpu.state.p.toString(16)} (I=${(cpu.state.p & 0x04) ? 1 : 0})`);

// Request IRQ and step
cpu.requestIRQ();
console.log('IRQ requested');
cpu.step();
console.log('After IRQ step:', `PC=$${cpu.state.pc.toString(16)} P=$${cpu.state.p.toString(16)}`);
