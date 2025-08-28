import { NESSystem } from '@core/system/system'

function buildIdlePrg(): Uint8Array {
  const prg = new Uint8Array(0x8000)
  // Reset at $8000: CLI; NOP; JMP $8003
  prg[0x0000] = 0x58
  prg[0x0001] = 0xEA
  prg[0x0002] = 0xEA
  prg[0x0003] = 0x4C; prg[0x0004] = 0x03; prg[0x0005] = 0x80
  // IRQ at $8100: RTI
  prg[0x0100] = 0x40
  // Vectors
  prg[0x7FFC] = 0x00; prg[0x7FFD] = 0x80
  prg[0x7FFE] = 0x00; prg[0x7FFF] = 0x81
  return prg
}

async function main() {
  const prg = buildIdlePrg()
  const chr = new Uint8Array(0x2000)
  const rom: any = { prg, chr, mapper: 4, hasTrainer: false, prgRamSize: 8*1024, flags6: 0x01, flags7: 0x00 }

  const sys = new NESSystem(rom)
  sys.reset(); (sys.ppu as any).setTimingMode?.('vt')
  sys.io.write(0x2001, 0x18)
  sys.io.write(0x2000, 0x08)
  sys.bus.write(0xC000 as any, 0)
  sys.bus.write(0xC001 as any, 0)
  sys.bus.write(0xE001 as any, 0)

  const mapper: any = (sys.cart as any).mapper

  let steps = 0
  let lastPrinted = 0
  while (steps < 2_000_000) {
    sys.stepInstruction()
    steps++
    if (steps - lastPrinted >= 100_000) {
      lastPrinted = steps
      const a12 = sys.ppu.getA12Trace().slice(-5)
      const mmc3 = mapper.getTrace ? mapper.getTrace().slice(-10) : []
      // eslint-disable-next-line no-console
      console.log(`[diag] steps=${steps} cpuCyc=${sys.cpu.state.cycles} ppu@[s${sys.ppu.scanline} c${sys.ppu.cycle}] a12=${a12.length ? a12.map(t=>`f${t.frame}s${t.scanline}c${t.cycle}`).join(',') : '(none)'} mmc3=${mmc3.length?mmc3.map((e:any)=>e.type+(e.c!==undefined?`@c${e.c}`:'')).join(','):'(no-trace)'}`)
      if (mapper.irqPending && mapper.irqPending()) {
        // eslint-disable-next-line no-console
        console.log(`[diag] IRQ pending at steps=${steps}`)
        break
      }
    }
  }
}

main().catch(e=>{ console.error(e); process.exit(1); })

