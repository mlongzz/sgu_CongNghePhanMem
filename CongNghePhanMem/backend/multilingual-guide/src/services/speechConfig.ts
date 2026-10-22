function bounded(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
// Device TTS uses installed voices and requires no cloud credentials.
export const speechConfig = {
  rate: bounded(process.env.EXPO_PUBLIC_TTS_RATE, 0.86, 0.1, 2),
  pitch: bounded(process.env.EXPO_PUBLIC_TTS_PITCH, 1, 0.5, 2),
};
