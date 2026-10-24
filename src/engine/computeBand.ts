/**
 * computeBand — speed ratio → Band. A pure rule; the LLM never sees audio or timing.
 *
 *   ratio = totalMs / expectedMs
 *   expectedMs = measured TTS duration of the reference sentence (accounts for syllable length),
 *                or wordCount / nativeWps as a fallback for older content
 *   A if ratio ≤ speedARatio (and pause/latency limits hold) · B if ratio ≤ speedBRatio · else C
 *
 * Only one knob tightens difficulty: when the denominator is a TTS duration (already slowed for
 * lower levels), the A-ratio stays fixed — tightening both would double-penalise.
 */
import type { BandResult, Timing } from "../contracts.ts";
import type { ScoringConfig } from "../config.ts";

export interface BandOptions {
  pauseRelaxMultiplier?: number;
  /** breaths at sentence boundaries are normal: allow (sentences − 1) extra pauses */
  extraPausesAllowed?: number;
  expectedMs?: number;
}

export function computeBand(timing: Timing, expectedWordCount: number, cfg: ScoringConfig, opts: BandOptions = {}): BandResult {
  const expectedMs =
    opts.expectedMs && opts.expectedMs > 0 ? opts.expectedMs : (Math.max(1, expectedWordCount) / cfg.nativeWps) * 1000;
  const ratio = timing.totalMs / expectedMs;
  const maxPausesA = cfg.maxPausesA * (opts.pauseRelaxMultiplier ?? 1) + Math.max(0, opts.extraPausesAllowed ?? 0);

  const band =
    ratio <= cfg.speedARatio && timing.pauseCount <= maxPausesA && timing.latencyMs <= cfg.maxLatencyAMs
      ? "A"
      : ratio <= cfg.speedBRatio
        ? "B"
        : "C";

  return { band, ratio, expectedMs: Math.round(expectedMs) };
}
