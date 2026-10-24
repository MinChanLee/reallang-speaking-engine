import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SCORING, loadScoring } from "../src/config.ts";
import type { EvaluableCard, Judge, Verdict, Word } from "../src/contracts.ts";
import { computeBand } from "../src/engine/computeBand.ts";
import { coverageInfo, wordsMatch } from "../src/engine/coverage.ts";
import { UnscorableSpeech, evaluateRep } from "../src/engine/evaluateRep.ts";
import { referenceMatchVerdict, speedGateOk } from "../src/engine/gates.ts";
import { deriveTiming } from "../src/engine/timing.ts";

const cfg = DEFAULT_SCORING;

/** words spaced `gap` ms apart, each 300 ms long, starting at `start` */
function words(text: string, start = 400, gap = 50): Word[] {
  let t = start;
  return text.split(" ").map((w) => {
    const word = { w, startMs: t, endMs: t + 300 };
    t += 300 + gap;
    return word;
  });
}

const ok: Verdict = { meaning: "pass", grammar: "ok", construction_used: true, ment: "", issues: [] };
const stubJudge = (v: Partial<Verdict>, calls: { n: number } = { n: 0 }): Judge => async () => {
  calls.n++;
  return { ...ok, ...v };
};

const card = (over: Partial<EvaluableCard> = {}): EvaluableCard => ({
  step: "ko_en",
  targetKo: "그 노래 들으면 기분 좋아져",
  construction: { name: "make + person + verb", detect_rule: "make + object + base verb" },
  referenceEn: "That song makes me feel good.",
  expectedWordCount: 6,
  ...over,
});

test("deriveTiming: pauses are gaps ≥ 500 ms; total excludes initial latency", () => {
  const ws: Word[] = [
    { w: "a", startMs: 700, endMs: 900 },
    { w: "b", startMs: 1000, endMs: 1200 }, // gap 100 — not a pause
    { w: "c", startMs: 1800, endMs: 2000 }, // gap 600 — pause
  ];
  const t = deriveTiming(ws);
  assert.equal(t.latencyMs, 700);
  assert.equal(t.totalMs, 1300);
  assert.equal(t.pauseCount, 1);
  assert.equal(t.speechMs, 700);
});

test("computeBand: TTS duration beats the word-count fallback as denominator", () => {
  const timing = deriveTiming(words("one two three four five six"));
  const byWords = computeBand(timing, 6, cfg);
  const byTts = computeBand(timing, 6, cfg, { expectedMs: 4000 });
  assert.equal(byTts.expectedMs, 4000);
  assert.ok(byTts.ratio < byWords.ratio);
});

test("computeBand: thresholds split A / B / C", () => {
  const t = (ms: number) => ({ ...deriveTiming([]), totalMs: ms });
  const expectedMs = 2000;
  assert.equal(computeBand(t(3000), 0, cfg, { expectedMs }).band, "A"); // 1.5
  assert.equal(computeBand(t(4000), 0, cfg, { expectedMs }).band, "B"); // 2.0
  assert.equal(computeBand(t(5000), 0, cfg, { expectedMs }).band, "C"); // 2.5
});

test("loadScoring: env overrides, and rejects non-numbers", () => {
  assert.equal(loadScoring({ SCORING_SPEED_A_RATIO: "1.4" }).speedARatio, 1.4);
  assert.throws(() => loadScoring({ SCORING_SPEED_A_RATIO: "fast" }));
});

test("coverage: plausible STT substitutions get credit, unrelated words do not", () => {
  const target = "Ignorance of the law is no excuse";
  assert.equal(coverageInfo("ignorance of the load is no excuse", target).ratio, 1); // law → load
  assert.ok(coverageInfo("ignorance of the bear is no excuse", target).ratio < 1); // law → bear
});

test("coverage: numbers are never fuzzy-matched; half a sentence is not coverage", () => {
  assert.equal(wordsMatch("2026", "2027"), false);
  assert.ok(coverageInfo("the meeting is at", "The meeting is at three o'clock on Friday").ratio < 0.88);
  assert.equal(coverageInfo("well the meeting is at three", "Well, the meeting is at three", ["well"]).scored, 5);
});

test("gates: read is a loose step (only C fails); production steps need A", () => {
  assert.equal(speedGateOk("read", "B"), true);
  assert.equal(speedGateOk("read", "C"), false);
  assert.equal(speedGateOk("ko_en", "B"), false);
});

test("referenceMatchVerdict ignores case and punctuation, but not a single word", () => {
  assert.ok(referenceMatchVerdict("that song makes me feel good", "That song makes me feel good."));
  assert.equal(referenceMatchVerdict("that song makes me feel great", "That song makes me feel good."), null);
});

test("evaluateRep: an exact reference answer never calls the judge", async () => {
  const calls = { n: 0 };
  const tr = "that song makes me feel good";
  const r = await evaluateRep(card(), deriveTiming(words(tr)), { text: tr, words: words(tr) }, cfg, stubJudge({}, calls));
  assert.equal(calls.n, 0);
  assert.equal(r.passed, true);
});

test("evaluateRep: failure reason follows meaning → grammar → construction → speed", async () => {
  const tr = "I feel good when I hear that song";
  const slow = { ...deriveTiming(words(tr)), totalMs: 60_000 }; // Band C
  const run = (v: Partial<Verdict>) => evaluateRep(card(), slow, { text: tr, words: [] }, cfg, stubJudge(v));
  assert.equal((await run({ meaning: "fail", grammar: "broken", construction_used: false })).gateFailReason, "meaning");
  assert.equal((await run({ grammar: "broken", construction_used: false })).gateFailReason, "grammar");
  assert.equal((await run({ construction_used: false })).gateFailReason, "construction");
  assert.equal((await run({})).gateFailReason, "speed");
});

test("evaluateRep: construction gate is soft for unmarked skeletons", async () => {
  const tr = "I feel good when I hear that song";
  const r = await evaluateRep(card({ constructionGateHard: false }), deriveTiming(words(tr)), { text: tr, words: [] }, cfg, stubJudge({ construction_used: false }));
  assert.equal(r.passed, true);
});

test("evaluateRep: silence is unscorable (422), not a failure", async () => {
  await assert.rejects(
    evaluateRep(card({ step: "read" }), deriveTiming([]), { text: "", words: [] }, cfg, stubJudge({})),
    (e: unknown) => e instanceof UnscorableSpeech && e.statusCode === 422,
  );
});

test("evaluateRep: read step fails on low coverage even when fast", async () => {
  const tr = "that song makes";
  const r = await evaluateRep(card({ step: "read" }), deriveTiming(words(tr)), { text: tr, words: [] }, cfg, stubJudge({}));
  assert.equal(r.passed, false);
  assert.equal(r.gateFailReason, "meaning");
});
