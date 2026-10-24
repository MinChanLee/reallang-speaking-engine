/**
 * Scoring constants. None of these are hard-coded in the engine: they are calibration knobs,
 * overridable from the environment, and tuned with `npm run eval:band` against labelled attempts.
 */
export interface ScoringConfig {
  /** Band A if ratio ≤ this (and pause/latency limits hold) */
  speedARatio: number;
  /** Band B if ratio ≤ this, otherwise C */
  speedBRatio: number;
  maxPausesA: number;
  maxLatencyAMs: number;
  /** native read-aloud pace, words/sec — fallback denominator when no TTS duration is stored */
  nativeWps: number;
  /** paragraph step: multiply the allowed pause count */
  paragraphPauseRelax: number;
  /** read steps: share of reference words that must actually be spoken */
  readCoverageMin: number;
}

export const DEFAULT_SCORING: ScoringConfig = {
  speedARatio: 1.6,
  speedBRatio: 2.2,
  // Pause-count and latency conditions exist as knobs but are effectively off in production:
  // pause time already lengthens totalMs, so the ratio absorbs it without double-penalising.
  maxPausesA: 9999,
  maxLatencyAMs: 600_000,
  nativeWps: 2.8,
  paragraphPauseRelax: 1.4,
  readCoverageMin: 0.88,
};

const ENV_KEYS: Record<keyof ScoringConfig, string> = {
  speedARatio: "SCORING_SPEED_A_RATIO",
  speedBRatio: "SCORING_SPEED_B_RATIO",
  maxPausesA: "SCORING_MAX_PAUSES_A",
  maxLatencyAMs: "SCORING_MAX_LATENCY_A_MS",
  nativeWps: "SCORING_NATIVE_WPS",
  paragraphPauseRelax: "SCORING_PARAGRAPH_PAUSE_RELAX",
  readCoverageMin: "SCORING_READ_COVERAGE_MIN",
};

export function loadScoring(env: Record<string, string | undefined> = process.env): ScoringConfig {
  const out = { ...DEFAULT_SCORING };
  for (const key of Object.keys(ENV_KEYS) as (keyof ScoringConfig)[]) {
    const raw = env[ENV_KEYS[key]];
    if (raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`${ENV_KEYS[key]} must be a number, got ${raw}`);
    out[key] = n;
  }
  return out;
}
