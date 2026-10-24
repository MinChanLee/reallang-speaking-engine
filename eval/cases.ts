/**
 * Labelled regression cases for the judge and the Band rule.
 *
 * Most judge cases are real mis-grades found while dogfooding, frozen here so the rubric can be
 * rewritten from principles without the same failure coming back. Each group is the boundary of
 * one rule: a case that must pass next to a case that must still fail.
 *
 * (Excerpt — the full suite has ~110 judge cases plus conversation, listening and content-generation sets.)
 */
import type { Construction, GateFailReason, IssueKind, Timing } from "../src/contracts.ts";

const C = (name: string, detect_rule: string): Construction => ({ name, detect_rule });
const REL_WHERE = C("noun + where/when/why + clause", "Place, time or reason noun + where/when/why + subject + verb, defining that noun");
const MAKE = C("make + person + verb", "make + object + base verb without to, forcing or causing someone to do something");
const IF2 = C("If + past, would", "If + past tense, would/could + base verb for an imagined, unreal present or future situation");
const PRES_PERF = C("have + past participle (experience)", "have/has + past participle stating whether something has happened at least once up to now, at no stated time");
const COMPARATIVE = C("comparative + than", "Adjective or adverb in -er/more form + than comparing two things");
const SV1 = C("subject + verb", "Clause built on subject + intransitive verb with no object; adverbials and prepositional phrases may follow freely");
const BE_Q = C("Be + subject …?", "Yes/no question formed by moving be before the subject");
const PAST = C("past simple", "Past tense of a lexical verb (-ed or irregular form) for a finished event at a past time");
const IF1 = C("If + present, will", "If + present tense clause with will/'ll/won't + base verb in the result clause, for a real, likely condition and its result");
const IF_CLAUSE = C("conditional if-clause", "An adverbial clause starting with If + subject + verb");

export interface JudgeCase {
  id: string;
  targetKo: string;
  construction: Construction;
  transcript: string;
  label: "pass" | "fail";
  reason?: GateFailReason;
  hardGate?: boolean;
  modality?: "speech" | "writing";
  reference?: string;
  /** finer check: the grammar axis must not be laundered to "ok" even when the label is unchanged */
  expectGrammar?: "ok" | "minor" | "broken";
  /** these kinds must appear in issues (the weakness ledger reads them) */
  expectIssueKinds?: IssueKind[];
  /** these kinds must NOT appear — "different from the reference" is not "wrong" */
  rejectIssueKinds?: IssueKind[];
  note: string;
}

export const JUDGE_CASES: JudgeCase[] = [
  // ── Construction gate: catch avoidance, nothing else ──
  { id: "rw-pass", targetKo: "내가 공부할 카페 있어?", construction: REL_WHERE, transcript: "Is there a cafe where I can study?", label: "pass", note: "where-clause used" },
  { id: "rw-bypass", targetKo: "내가 공부할 카페 있어?", construction: REL_WHERE, transcript: "Is there a good cafe for studying?", label: "fail", reason: "construction", note: "meaning right, target form avoided" },
  { id: "rw-minor", targetKo: "내가 공부할 카페 있어?", construction: REL_WHERE, transcript: "Is there cafe where I can study?", label: "pass", note: "missing article is minor" },
  { id: "rw-broken", targetKo: "내가 공부할 카페 있어?", construction: REL_WHERE, transcript: "Cafe study where go I want", label: "fail", reason: "grammar", note: "collapsed word order" },
  { id: "mk-bypass", targetKo: "그 노래 들으면 기분 좋아져", construction: MAKE, transcript: "I feel good when I hear that song.", label: "fail", reason: "construction", note: "make not used" },
  { id: "mk-minor", targetKo: "그 노래 들으면 기분 좋아져", construction: MAKE, transcript: "That song make me happy.", label: "pass", note: "third-person s missing is minor" },
  { id: "if2-partial", targetKo: "내가 부자라면 그걸 살 텐데", construction: IF2, transcript: "If I rich I buy it.", label: "fail", reason: "construction", note: "no past / would → form not realized" },
  { id: "pp-bypass", targetKo: "그 영화 본 적 있어?", construction: PRES_PERF, transcript: "Did you see that movie?", label: "fail", reason: "construction", note: "past simple, not present perfect" },
  { id: "cmp-pass", targetKo: "이게 저것보다 나아", construction: COMPARATIVE, transcript: "This is better than that one.", label: "pass", note: "comparative + than" },

  // ── Meaning = the listener test (dogfood mis-grades) ──
  { id: "sv-nuance", targetKo: "나 이번 주말에 산에 갔다 왔어.", construction: SV1, hardGate: false, transcript: "I have been in the mountains this weekend.", label: "pass", note: "tense/preposition nuance — a listener gets the same situation" },
  { id: "sv-other", targetKo: "나 이번 주말에 산에 갔다 왔어.", construction: SV1, hardGate: false, transcript: "I like mountains very much.", label: "fail", reason: "meaning", note: "a different situation — rightly rejected" },
  { id: "nu-mislead", targetKo: "나 어제 회사 그만뒀어.", construction: PAST, hardGate: false, transcript: "I finished my work yesterday.", label: "fail", reason: "meaning", note: "listener hears 'finished work for the day'" },
  { id: "nu-awkward", targetKo: "나 어제 회사 그만뒀어.", construction: PAST, hardGate: false, transcript: "I quit from my company yesterday.", label: "pass", note: "awkward preposition, no misunderstanding" },

  // ── Reference bias: the reference may justify a pass, never a fail ──
  { id: "ref-article", targetKo: "오늘 카페 갔다 왔거든.", construction: SV1, hardGate: false, modality: "writing", reference: "I went to the cafe today.", transcript: "I went to a cafe today.", label: "pass", note: "differs from reference only in the article" },
  { id: "ref-phrasing", targetKo: "잠깐, 그게 진짜야? 나 아직 못 봤는데.", construction: BE_Q, modality: "writing", reference: "Wait, is that actually true? I haven't seen it yet.", transcript: "For real? Is that true? I haven't seen it yet.", label: "pass", note: "a different natural phrasing" },
  { id: "ref-still-fail", targetKo: "오늘 카페 갔다 왔거든.", construction: SV1, hardGate: false, modality: "writing", reference: "I went to the cafe today.", transcript: "I like mountains very much.", label: "fail", reason: "meaning", note: "showing the reference must not make the judge lenient" },

  // ── The reference calibrates an over-specified detect_rule ──
  { id: "if1-ref-variant", targetKo: "비 오면 그냥 집에 있으려고.", construction: IF1, reference: "If it rains, I'm just staying home.", transcript: "if it rains I'm gonna stay home", label: "pass", note: "the reference has no 'will' either — it cannot be demanded" },
  { id: "if1-avoided", targetKo: "비 오면 그냥 집에 있으려고.", construction: IF1, modality: "writing", reference: "If it rains, I'm just staying home.", transcript: "I'm just going to stay home because of the rain.", label: "fail", reason: "construction", note: "calibration does not switch the gate off" },
  { id: "u2-contraction", targetKo: "오늘 좀 늦을 것 같아.", construction: SV1, hardGate: false, reference: "I'm going to be a little late today.", transcript: "I am going to be a little late today", label: "pass", note: "not an exact match → goes to the judge, which must pass it" },

  // ── Transcripts: punctuation and mishearings are the transcriber's ──
  { id: "punc-fragment", targetKo: "요즘 잘나가는 아이돌을 섭외하면 무대가 훨씬 살 거야.", construction: IF1, reference: "If we book some hot idols these days, the stage will be way better.", transcript: "If we just book. Some hot idols these days, the stage will be way better.", label: "pass", note: "STT put a full stop at a breath — read it as one utterance" },
  { id: "stt-mishear", targetKo: "대학이면 축제에 당연히 가수랑 연예인 오고, 당연히 친구들이랑 안주 좋은 주점 텐트에서 술 마시는 거 아니야?", construction: IF_CLAUSE,
    reference: "If it's college, of course the festival brings in singers and celebrities, and of course you drink with friends at a pub tent with good snacks — isn't that obvious?",
    transcript: "If it's college Of course The faster it brings in singers and celebrities And of course you drink with friends at a pub tent with good snacks Isn't that obvious",
    label: "pass", note: "real case: 'the festival' heard as 'the faster it'" },
  { id: "stt-mishear-other", targetKo: "대학이면 축제에 당연히 가수랑 연예인 오고, 당연히 친구들이랑 안주 좋은 주점 텐트에서 술 마시는 거 아니야?", construction: IF_CLAUSE,
    reference: "If it's college, of course the festival brings in singers and celebrities, and of course you drink with friends at a pub tent with good snacks — isn't that obvious?",
    transcript: "If it's college of course the festival brings in professors and students and of course you study with friends at the library",
    label: "fail", reason: "meaning", note: "a different situation, not a mishearing — the rescue must not leak" },

  // ── …but inflection errors are the speaker's, and must reach the weakness ledger ──
  { id: "mask-3sg", targetKo: "걔는 요즘 병원에서 일해.", construction: SV1, hardGate: false, reference: "She works at a hospital these days.", transcript: "She work at a hospital these days",
    label: "pass", expectGrammar: "minor", expectIssueKinds: ["agreement"], note: "must not be 'rescued' into 'works'" },
  { id: "mask-tense", targetKo: "어제 카페 가서 공부 좀 했어.", construction: PAST, hardGate: false, reference: "I went to a cafe yesterday and studied a bit.", transcript: "Yesterday I go to a cafe and study a bit",
    label: "pass", expectGrammar: "minor", expectIssueKinds: ["tense"], note: "tense inflection is kept by STT — report it" },

  // ── Writing: spelling is the learner's own product ──
  { id: "wr-nonword", targetKo: "잠깐, 그럼 우주가 나중에 다시 쪼그라들 수도 있다는 거야?", construction: BE_Q, modality: "writing", transcript: "Wait, then is the universe able to be squized again later?", label: "fail", reason: "grammar", note: "non-existent word form in writing → broken" },
  { id: "wr-compound", targetKo: "오늘 유튜브에서 블랙홀 다큐를 봤어.", construction: PAST, hardGate: false, modality: "writing", transcript: "Today I watched a blackhole documentary on youtube.", label: "pass", note: "joined compound + lowercase brand are real spellings" },

  // ── Issue labels: report every real problem, never a mere difference ──
  { id: "iss-article", targetKo: "나 어제 카페에서 친구 만났어.", construction: PAST, hardGate: false, modality: "writing", reference: "I met a friend at a cafe yesterday.", transcript: "I met friend at cafe yesterday.", label: "pass", expectIssueKinds: ["article"], note: "two missing articles fold into one issue" },
  { id: "iss-order", targetKo: "나 일요일마다 항상 거기 가.", construction: SV1, hardGate: false, modality: "writing", reference: "I always go there on Sundays.", transcript: "I go always there on Sundays.", label: "pass", expectIssueKinds: ["word_order"], note: "frequency adverb position" },
  { id: "iss-natural-diff", targetKo: "괜찮아, 다음에 하자.", construction: SV1, hardGate: false, modality: "writing", reference: "No worries, let's do it next time.", transcript: "It's okay, let's do it another time.", label: "pass", rejectIssueKinds: ["word_choice", "collocation"], note: "equally natural — different is not wrong" },
];

export interface BandCase {
  id: string;
  timing: Timing;
  expectedWordCount: number;
  label: "A" | "B" | "C";
}

const T = (totalMs: number, latencyMs: number, pauseCount: number): Timing => ({
  latencyMs,
  pauseCount,
  pauseTotalMs: pauseCount * 500,
  pauses: [],
  totalMs,
  speechMs: totalMs - pauseCount * 500,
  wpm: 0,
});

/** 8 words → expectedMs ≈ 2857 at 2.8 wps. Labels are placeholders until replaced by human-rated attempts. */
export const BAND_CASES: BandCase[] = [
  { id: "a-fast", timing: T(2400, 400, 0), expectedWordCount: 8, label: "A" }, // ratio 0.84
  { id: "a-clean", timing: T(4000, 700, 1), expectedWordCount: 8, label: "A" }, // 1.40
  { id: "a-edge", timing: T(4500, 1100, 0), expectedWordCount: 8, label: "A" }, // 1.58
  { id: "b-slowish", timing: T(5400, 900, 1), expectedWordCount: 8, label: "B" }, // 1.89
  { id: "b-pauses", timing: T(4200, 800, 3), expectedWordCount: 8, label: "B" }, // 1.47, but 3 pauses
  { id: "b-latency", timing: T(4000, 1800, 0), expectedWordCount: 8, label: "B" }, // 1.40, but slow start
  { id: "b-edge", timing: T(6200, 900, 1), expectedWordCount: 8, label: "B" }, // 2.17
  { id: "c-slow", timing: T(7200, 1200, 3), expectedWordCount: 8, label: "C" }, // 2.52
  { id: "c-veryslow", timing: T(9000, 2000, 5), expectedWordCount: 8, label: "C" }, // 3.15
  { id: "c-halting", timing: T(6800, 1500, 4), expectedWordCount: 8, label: "C" }, // 2.38
];
