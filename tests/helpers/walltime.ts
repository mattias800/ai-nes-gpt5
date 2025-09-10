export const vitestTimeout = (envVar: string, fallbackMs: number): number => {
  const raw = process.env[envVar];
  if (raw && /^\d+$/.test(raw)) return parseInt(raw, 10);
  return fallbackMs;
};

export const mkWallDeadline = (envVar: string, fallbackMs: number): number => {
  return Date.now() + vitestTimeout(envVar, fallbackMs);
};

export const hitWall = (deadline: number): boolean => Date.now() >= deadline;

