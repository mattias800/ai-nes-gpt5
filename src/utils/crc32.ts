// Simple CRC32 for framebuffer tests
const table = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : (c >>> 1);
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let crc = ~0 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    const idx = (crc ^ bytes[i]) & 0xFF;
    crc = (crc >>> 8) ^ table[idx];
  }
  return (~crc) >>> 0;
}
