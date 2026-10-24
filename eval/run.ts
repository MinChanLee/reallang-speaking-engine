/**
 * Eval harness.
 *   node eval/run.ts band    — Band rule vs. labels: accuracy, confusion matrix, threshold grid sweep (offline)
 *   node eval/run.ts judge   — real LLM judge vs. labels: gate agreement, failure-reason agreement, p50/p95 latency
 *                              (needs ANTHROPIC_API_KEY; EVAL_CONCURRENCY, default 8)
 *
 * The judge eval goes through the same path as production: exact reference matches skip the LLM,
 * and the PASS/fail label is derived by the same gate order the engine uses.
 */
import { loadScoring } from "../src/config.ts";
import type { ScoringConfig } from "../src/config.ts";
import type { GateFailReason, Verdict } from "../src/contracts.ts";
import { computeBand } from "../src/engine/computeBand.ts";
import { referenceMatchVerdict } from "../src/engine/gates.ts";
import { createClaudeJudge } from "../src/judge/claudeJudge.ts";
import { BAND_CASES, JUDGE_CASES } from "./cases.ts";

const pct = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

function bandAccuracy(cfg: ScoringConfig) {
  const confusion: Record<string, Record<string, number>> = {
    A: { A: 0, B: 0, C: 0 },
    B: { A: 0, B: 0, C: 0 },
    C: { A: 0, B: 0, C: 0 },
  };
  let correct = 0;
  for (const c of BAND_CASES) {
    const got = computeBand(c.timing, c.expectedWordCount, cfg).band;
    confusion[c.label]![got]!++;
    if (got === c.label) correct++;
  }
  return { acc: correct / BAND_CASES.length, confusion };
}

function evalBand(): void {
  const cfg = loadScoring();
  const cur = bandAccuracy(cfg);
  console.log("\n=== Band rule calibration (deterministic) ===");
  console.log(`current  A≤${cfg.speedARatio} B≤${cfg.speedBRatio} maxPausesA=${cfg.maxPausesA} maxLatencyA=${cfg.maxLatencyAMs}ms`);
  console.log(`accuracy ${(cur.acc * 100).toFixed(1)}%   confusion (row = label, col = predicted)`);
  console.log("        A   B   C");
  for (const l of ["A", "B", "C"]) {
    const r = cur.confusion[l]!;
    console.log(`  ${l}   ${String(r.A).padStart(2)}  ${String(r.B).padStart(2)}  ${String(r.C).padStart(2)}`);
  }

  let best = { ...cfg, acc: cur.acc };
  for (let a = 1.3; a <= 1.9 + 1e-9; a += 0.1) {
    for (let b = a + 0.2; b <= 2.6 + 1e-9; b += 0.1) {
      for (const maxPausesA of [1, 2, 3, cfg.maxPausesA]) {
        for (const maxLatencyAMs of [1200, 1500, 2000, cfg.maxLatencyAMs]) {
          const trial = { ...cfg, speedARatio: +a.toFixed(2), speedBRatio: +b.toFixed(2), maxPausesA, maxLatencyAMs };
          const { acc } = bandAccuracy(trial);
          if (acc > best.acc) best = { ...trial, acc };
        }
      }
    }
  }
  console.log(`\nsweep best  A≤${best.speedARatio} B≤${best.speedBRatio} maxPausesA=${best.maxPausesA} maxLatencyA=${best.maxLatencyAMs}ms → ${(best.acc * 100).toFixed(1)}%`);
  console.log("note: Band labels are placeholders; the sweep becomes a real calibration once they are human-rated attempts.");
}

function accuracyGate(v: Verdict, hardGate: boolean): { pass: boolean; reason?: GateFailReason } {
  if (v.meaning === "fail") return { pass: false, reason: "meaning" };
  if (v.grammar === "broken") return { pass: false, reason: "grammar" };
  if (hardGate && !v.construction_used) return { pass: false, reason: "construction" };
  return { pass: true };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

async function evalJudge(): Promise<void> {
  const judge = createClaudeJudge();
  const concurrency = Number(process.env.EVAL_CONCURRENCY ?? 8);
  console.log("\n=== Judge accuracy (real LLM, accuracy gate only) ===");
  const lat: number[] = [];
  let fast = 0;
  const rows = await mapLimit(JUDGE_CASES, concurrency, async (c) => {
    const t0 = Date.now();
    const matched = referenceMatchVerdict(c.transcript, c.reference);
    let v: Verdict;
    try {
      v = matched ?? (await judge({ targetKo: c.targetKo, construction: c.construction, transcript: c.transcript, modality: c.modality ?? "speech", ...(c.reference ? { reference: c.reference } : {}) }));
    } catch (e) {
      return { c, ok: false, reasonOk: false, line: `ERROR ${(e as Error).message}` };
    }
    if (matched) fast++;
    else lat.push(Date.now() - t0);
    const g = accuracyGate(v, c.hardGate ?? true);
    const kinds = new Set(v.issues.map((i) => i.kind));
    const grammarOk = c.expectGrammar === undefined || v.grammar === c.expectGrammar;
    const issuesOk = (c.expectIssueKinds ?? []).every((k) => kinds.has(k)) && !(c.rejectIssueKinds ?? []).some((k) => kinds.has(k));
    const ok = (g.pass ? "pass" : "fail") === c.label && grammarOk && issuesOk;
    const reasonOk = c.label === "fail" && !g.pass && g.reason === c.reason;
    const got = (g.pass ? "pass" : `fail:${g.reason}`) + ` g:${v.grammar}` + (kinds.size ? ` [${[...kinds].join(",")}]` : "");
    return { c, ok, reasonOk, line: got };
  });

  for (const r of rows) console.log(`  ${r.ok ? "✓" : "✗"} ${r.c.id.padEnd(18)} expect ${r.c.label.padEnd(4)} → ${r.line}`);
  const n = rows.length;
  const correct = rows.filter((r) => r.ok).length;
  const fails = rows.filter((r) => r.c.label === "fail");
  console.log(`\n  label agreement        ${correct}/${n} = ${((correct / n) * 100).toFixed(1)}%`);
  console.log(`  fail-reason agreement  ${fails.filter((r) => r.reasonOk).length}/${fails.length}`);
  console.log(`  latency p50/p95        ${pct(lat, 50)}ms / ${pct(lat, 95)}ms (judge calls only)`);
  console.log(`  fast path (exact ref)  ${fast}/${n}`);
}

const which = process.argv[2] ?? "band";
if (which === "band" || which === "all") evalBand();
if (which === "judge" || which === "all") await evalJudge();
