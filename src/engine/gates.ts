/**
 * Which gates apply to which step.
 *  - Accuracy gate (LLM judge): steps where the learner produces the sentence themselves.
 *    read = the English is on screen → reading fluency only, checked by deterministic coverage instead.
 *  - Speed gate: every step here. read is a "loose" step (anything but Band C passes) —
 *    early ladder steps tighten form and relax speed; asking for both at once gets neither.
 */
import type { Band, Step, Verdict } from "../contracts.ts";

const ACCURACY_GATED: ReadonlySet<Step> = new Set<Step>(["ko_en", "keyword", "paragraph", "freetalk"]);
const SPEED_LOOSE: ReadonlySet<Step> = new Set<Step>(["read"]);

export const isAccuracyGated = (step: Step): boolean => ACCURACY_GATED.has(step);

export const speedGateOk = (step: Step, band: Band): boolean => (SPEED_LOOSE.has(step) ? band !== "C" : band === "A");

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Fast path: the learner said the reference sentence itself (ignoring case, punctuation, spacing).
 * The reference is by construction a correct rendering that realises the target form, so any
 * meaning/grammar/construction failure the judge returned here would only be model noise —
 * skip the LLM call. One differing word and the judge decides as usual.
 */
export function referenceMatchVerdict(text: string, reference: string | undefined): Verdict | null {
  if (!reference || normalize(text) !== normalize(reference)) return null;
  return { meaning: "pass", grammar: "ok", construction_used: true, ment: "", issues: [] };
}
