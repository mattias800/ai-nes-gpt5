// APU constants for NTSC (and placeholder for PAL)
// Prefer importing these over hardcoding in channel logic.

export const NOISE_PERIODS_NTSC: number[] = [
  4, 8, 16, 32, 64, 96, 128, 160,
  202, 254, 380, 508, 762, 1016, 2034, 4068,
]

// PAL noise periods (2A07): derive by scaling NTSC periods by CPU_PAL/CPU_NTSC and rounding to nearest.
// This matches the intent of maintaining similar audible frequencies across regions.
const CPU_NTSC = 1789773;
const CPU_PAL = 1662607;
const PAL_SCALE = CPU_PAL / CPU_NTSC; // ≈0.929
export const NOISE_PERIODS_PAL: number[] = NOISE_PERIODS_NTSC.map((p) => Math.max(4, Math.round(p * PAL_SCALE)));

export const DMC_PERIODS_NTSC: number[] = [
  428, 380, 340, 320, 286, 254, 226, 214,
  190, 160, 142, 128, 106, 85, 72, 54,
]

// PAL (2A07) DMC rates (CPU cycles)
export const DMC_PERIODS_PAL: number[] = [
  398, 354, 316, 298, 276, 236, 210, 198,
  176, 148, 132, 118, 98, 78, 66, 50,
]

export const LENGTH_TABLE: number[] = [
  10, 254, 20, 2, 40, 4, 80, 6,
  160, 8, 60, 10, 14, 12, 26, 14,
  12, 16, 24, 18, 48, 20, 96, 22,
  192, 24, 72, 26, 16, 28, 32, 30,
]

export const DUTY_SEQUENCES: number[][] = [
  [0,1,0,0,0,0,0,0], // 12.5%
  [0,1,1,0,0,0,0,0], // 25%
  [0,1,1,1,1,0,0,0], // 50%
  [1,0,0,1,1,1,1,1], // 75%
]

export type Region = 'NTSC' | 'PAL'

export const getNoisePeriods = (region: Region): number[] => (region === 'PAL' ? NOISE_PERIODS_PAL : NOISE_PERIODS_NTSC)
export const getDmcPeriods = (region: Region): number[] => (region === 'PAL' ? DMC_PERIODS_PAL : DMC_PERIODS_NTSC)

