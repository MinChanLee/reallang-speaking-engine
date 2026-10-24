/**
 * Engine contracts — the shapes that cross the client/server and rule/LLM boundaries.
 *
 * The split these types encode:
 *  - Timing / Transcript come from the audio pipeline (VAD + filler-aware STT). Deterministic.
 *  - BandResult (speed) is computed by a **rule**, never by the LLM.
 *  - Verdict (accuracy) is produced by the **LLM judge**, which only ever sees transcript text + target — no audio.
 *  - RepResult (PASS/FAIL) is composed by the **engine** from the two. The LLM never decides PASS.
 */

export const BANDS = ["A", "B", "C"] as const;
export type Band = (typeof BANDS)[number];

/**
 * Steps of the speaking ladder for one sentence card, from most to least support.
 * read = read the English aloud · ko_en = say it from the Korean · keyword = from keyword hints
 * paragraph = several sentences in a row · freetalk = no hints at all.
 */
export const STEPS = ["read", "ko_en", "keyword", "paragraph", "freetalk"] as const;
export type Step = (typeof STEPS)[number];

export const GATE_FAIL_REASONS = ["meaning", "grammar", "construction", "speed"] as const;
export type GateFailReason = (typeof GATE_FAIL_REASONS)[number];

export interface Pause {
  startMs: number;
  endMs: number;
}

export interface Timing {
  latencyMs: number; // prompt shown → first word
  pauseCount: number;
  pauseTotalMs: number;
  pauses: Pause[];
  totalMs: number; // first word → last word
  speechMs: number; // totalMs minus pauses
  wpm: number;
}

export interface Word {
  w: string;
  startMs: number;
  endMs: number;
}

export interface Transcript {
  text: string;
  words: Word[];
}

export interface BandResult {
  band: Band;
  /** speed ratio = totalMs / expectedMs (1.0 = native read-aloud pace) */
  ratio: number;
  expectedMs: number;
}

/** Closed list of issue kinds the judge may report. The code owns labels — anything else is dropped. */
export const ISSUE_KINDS = [
  "word_choice",
  "collocation",
  "article",
  "preposition",
  "tense",
  "agreement",
  "word_order",
  "spelling",
] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];

/** Why a spot counts as a problem at all. "Differs from the reference" is deliberately not on this list. */
export const ISSUE_GROUNDS = ["misleads_listener", "ill_formed", "non_native_usage"] as const;
export type IssueGround = (typeof ISSUE_GROUNDS)[number];

export interface Issue {
  kind: IssueKind;
  grounds: IssueGround;
  note: string;
}

export interface Verdict {
  meaning: "pass" | "fail";
  grammar: "ok" | "minor" | "broken";
  construction_used: boolean;
  /** coaching text shown to the learner — not used for the PASS decision */
  ment: string;
  issues: Issue[];
}

export interface RepResult {
  band: BandResult;
  verdict: Verdict;
  passed: boolean;
  gateFailReason?: GateFailReason;
}

/** The target grammar construction a card trains, described as a minimal surface form. */
export interface Construction {
  name: string;
  detect_rule: string;
}

/** Only what the engine needs from a card to score one attempt. */
export interface EvaluableCard {
  step: Step;
  targetKo: string;
  construction: Construction;
  /** false for unmarked skeletons (e.g. plain S+V) — there is nothing to "avoid", so coach only */
  constructionGateHard?: boolean;
  /** a natural English answer. Calibrates the construction test; never grounds for failing. */
  referenceEn?: string;
  /** read steps: tokens excluded from coverage (discourse markers, articles ASR often drops) */
  unscoredWords?: string[];
  expectedWordCount: number;
  /** measured TTS duration of the reference — preferred speed denominator when present */
  expectedDurationMs?: number;
  sentenceCount?: number;
}

export interface JudgeInput {
  targetKo: string;
  construction: Construction;
  transcript: string;
  modality: "speech" | "writing";
  reference?: string;
}

/** The judge is injected — production uses an LLM, tests use a stub. */
export type Judge = (input: JudgeInput) => Promise<Verdict>;

/**
 * Runtime validation of an LLM verdict. Structured outputs guarantee the JSON shape,
 * but the engine still refuses to trust a value it has not checked.
 */
export function parseVerdict(raw: unknown): Verdict {
  const v = raw as Record<string, unknown>;
  const fail = (field: string): never => {
    throw new Error(`invalid verdict field: ${field}`);
  };
  if (v?.meaning !== "pass" && v?.meaning !== "fail") fail("meaning");
  if (!["ok", "minor", "broken"].includes(v.grammar as string)) fail("grammar");
  if (typeof v.construction_used !== "boolean") fail("construction_used");
  if (typeof v.ment !== "string") fail("ment");
  if (!Array.isArray(v.issues)) fail("issues");
  return {
    meaning: v.meaning as Verdict["meaning"],
    grammar: v.grammar as Verdict["grammar"],
    construction_used: v.construction_used as boolean,
    ment: v.ment as string,
    issues: v.issues as Issue[],
  };
}
