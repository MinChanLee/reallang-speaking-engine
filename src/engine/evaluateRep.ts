/**
 * evaluateRep — composes PASS from two independent gates.
 *
 *   PASS = accuracy gate ∧ fluency gate
 *   accuracy = meaning ✓ ∧ grammar not broken ∧ target construction used (hard gate)
 *
 * The judge only returns a verdict; the engine decides. Failure reasons are checked in a fixed order —
 * meaning → grammar → construction → speed — so a garbage answer never gets "the meaning was right,
 * just a bit slow" as feedback. Speed is only looked at once accuracy has passed.
 */
import type { EvaluableCard, GateFailReason, Judge, RepResult, Timing, Transcript, Verdict } from "../contracts.ts";
import type { ScoringConfig } from "../config.ts";
import { computeBand } from "./computeBand.ts";
import { coverageInfo } from "./coverage.ts";
import { isAccuracyGated, referenceMatchVerdict, speedGateOk } from "./gates.ts";

const READ_VERDICT: Verdict = { meaning: "pass", grammar: "ok", construction_used: true, ment: "", issues: [] };

/**
 * Almost nothing was heard. This is "cannot score", not "failed": recording it as a failure would
 * write a false meaning-failure into the learner's history and push them down the ladder.
 * The API maps it to 422 and nothing is persisted.
 */
export class UnscorableSpeech extends Error {
  readonly statusCode = 422;
}

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

export async function evaluateRep(
  card: EvaluableCard,
  timing: Timing,
  transcript: Transcript,
  cfg: ScoringConfig,
  judge: Judge,
): Promise<RepResult> {
  const band = computeBand(timing, card.expectedWordCount, cfg, {
    pauseRelaxMultiplier: card.step === "paragraph" ? cfg.paragraphPauseRelax : 1,
    extraPausesAllowed: Math.max(0, (card.sentenceCount ?? 1) - 1),
    ...(card.expectedDurationMs ? { expectedMs: card.expectedDurationMs } : {}),
  });

  // Silence guard, before any LLM call. An empty transcript has totalMs 0 → ratio 0 → Band A,
  // and read steps have no judge — silence used to pass. Require 20% of expected words (min 1, max 3).
  const minWords = Math.min(3, Math.max(1, Math.ceil(card.expectedWordCount * 0.2)));
  if (wordCount(transcript.text) < minWords) throw new UnscorableSpeech("barely heard — please try again");

  if (!isAccuracyGated(card.step)) {
    if (card.referenceEn) {
      const cov = coverageInfo(transcript.text, card.referenceEn, card.unscoredWords ?? []);
      if (cov.ratio < cfg.readCoverageMin) {
        const ment = `About ${Math.round(cov.ratio * 100)}% of the sentence was heard — read it through to the end.`;
        return { band, verdict: { ...READ_VERDICT, meaning: "fail", ment }, passed: false, gateFailReason: "meaning" };
      }
    }
    const passed = speedGateOk(card.step, band.band);
    return { band, verdict: READ_VERDICT, passed, ...(passed ? {} : { gateFailReason: "speed" as const }) };
  }

  const verdict =
    referenceMatchVerdict(transcript.text, card.referenceEn) ??
    (await judge({
      targetKo: card.targetKo,
      construction: card.construction,
      transcript: transcript.text,
      modality: "speech",
      ...(card.referenceEn ? { reference: card.referenceEn } : {}),
    }));

  let gateFailReason: GateFailReason | undefined;
  if (verdict.meaning === "fail") gateFailReason = "meaning";
  else if (verdict.grammar === "broken") gateFailReason = "grammar";
  else if (card.constructionGateHard !== false && !verdict.construction_used) gateFailReason = "construction";
  else if (!speedGateOk(card.step, band.band)) gateFailReason = "speed";

  return { band, verdict, passed: gateFailReason === undefined, ...(gateFailReason ? { gateFailReason } : {}) };
}
