#!/usr/bin/env tsx
/*
  Dump NES audio to WAV (PCM16LE) by running the emulator headless.
  Usage:
    npm run dump:wav -- <rom_path> [--seconds 10] [--sr 48000] [--ch 2] [--out out.wav]
*/
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { NESSystem } from '@core/system/system'
import { parseINes } from '@core/cart/ines'

const CPU_HZ = 1789773

interface CliOptions { romPath: string; seconds: number; sampleRate: number; channels: number; outPath: string }

const parseArgs = (): CliOptions => {
  const argv = process.argv.slice(2)
  if (argv.length === 0) {
    console.error('Usage: dump-wav <rom_path> [--seconds 10] [--sr 48000] [--ch 2] [--out out.wav]')
    process.exit(1)
  }
  let romPath = ''
  let seconds = 10
  let sampleRate = 48000
  let channels = 2
  let outPath = ''
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--seconds' || a === '--s' || a === '-s') { seconds = Math.max(1, Number(argv[++i] || 10)) }
    else if (a === '--sr' || a === '--sample-rate' || a === '-r') { sampleRate = Math.max(8000, Number(argv[++i] || 48000)) }
    else if (a === '--ch' || a === '--channels' || a === '-c') { channels = Math.max(1, Math.min(2, Number(argv[++i] || 2))) }
    else if (a === '--out' || a === '-o') { outPath = String(argv[++i] || '') }
    else if (a.startsWith('-')) { /* skip unknown flag */ }
    else { romPath = a }
  }
  if (!romPath) { console.error('Missing rom_path'); process.exit(1) }
  if (!outPath) {
    const base = basename(romPath).replace(/\.[^.]+$/, '')
    outPath = resolve(`out/${base}_${sampleRate}Hz_${seconds}s.wav`)
  } else {
    outPath = resolve(outPath)
  }
  return { romPath, seconds, sampleRate, channels, outPath }
}

const clamp = (v: number): number => v < -1 ? -1 : (v > 1 ? 1 : v)

const floatToPCM16 = (f: number): number => {
  const x = Math.round(clamp(f) * 32767)
  return x
}

const writeWavPCM16 = async (filePath: string, interleaved: Int16Array, sampleRate: number, channels: number): Promise<void> => {
  const dataBytes = interleaved.length * 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // PCM fmt chunk size
  header.writeUInt16LE(1, 20)  // PCM format
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  const byteRate = sampleRate * channels * 2
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(channels * 2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(dataBytes, 40)
  const body = Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength)
  await writeFile(filePath, Buffer.concat([header, body]))
}

const generateSamples = (sys: NESSystem, frames: number, sampleRate: number, channels: number): Int16Array => {
  const out = new Int16Array(frames * channels)
  let lastCycles = 0
  let targetCycles = 0
  const cyclesPerSample = CPU_HZ / sampleRate
  if (lastCycles === 0) { lastCycles = sys.cpu.state.cycles; targetCycles = lastCycles }
  for (let i = 0; i < frames; i++) {
    targetCycles += cyclesPerSample
    while (sys.cpu.state.cycles < targetCycles) sys.stepInstruction()
    const amp = (((sys.apu.mixSample() | 0) - 128) / 128)
    const s = floatToPCM16(amp)
    if (channels === 2) { const p = i * 2; out[p] = s; out[p + 1] = s } else { out[i] = s }
    lastCycles = sys.cpu.state.cycles
  }
  return out
}

const main = async (): Promise<void> => {
  const opts = parseArgs()
  const romBytes = new Uint8Array(await readFile(resolve(opts.romPath)))
  const rom = parseINes(romBytes)
  const sys = new NESSystem(rom)
  ;(sys.ppu as unknown as { setTimingMode?: (m: 'vt'|'legacy') => void }).setTimingMode?.('vt')
  sys.reset()
  sys.io.write(0x2001, 0x1E)
  const totalFrames = Math.round(opts.seconds * opts.sampleRate)
  const pcm = generateSamples(sys, totalFrames, opts.sampleRate, opts.channels)
  await writeWavPCM16(opts.outPath, pcm, opts.sampleRate, opts.channels)
  console.log(`WAV written: ${opts.outPath}`)
}

main().catch((e) => { console.error(e); process.exit(1) })

