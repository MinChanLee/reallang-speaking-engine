/**
 * deriveTiming — timing numbers from STT word timestamps. Deterministic, no model involved.
 */
import type { Timing, Word } from "../contracts.ts";

/**
 * A gap between words at least this long counts as a pause.
 * 300 ms counted ordinary comma breaths as pauses and normal read-aloud missed Band A on real devices → 500.
 */
export const PAUSE_MIN_MS = 500;

export function deriveTiming(words: Word[]): Timing {
  if (words.length === 0) {
    return { latencyMs: 0, pauseCount: 0, pauseTotalMs: 0, pauses: [], totalMs: 0, speechMs: 0, wpm: 0 };
  }
  const first = words[0]!;
  const last = words[words.length - 1]!;
  const latencyMs = Math.max(0, first.startMs);
  const totalMs = Math.max(0, last.endMs - first.startMs);

  const pauses: Timing["pauses"] = [];
  let pauseTotalMs = 0;
  for (let i = 1; i < words.length; i++) {
    const gap = words[i]!.startMs - words[i - 1]!.endMs;
    if (gap >= PAUSE_MIN_MS) {
      pauses.push({ startMs: words[i - 1]!.endMs, endMs: words[i]!.startMs });
      pauseTotalMs += gap;
    }
  }
  return {
    latencyMs,
    pauseCount: pauses.length,
    pauseTotalMs,
    pauses,
    totalMs,
    speechMs: Math.max(0, totalMs - pauseTotalMs),
    wpm: totalMs > 0 ? words.length / (totalMs / 60_000) : 0,
  };
}
