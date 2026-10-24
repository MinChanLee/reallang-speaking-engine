# Real Lang — Speaking Scoring Engine (excerpt)

Real Lang is a language-acquisition app I'm building solo: Korean speakers learn English by speaking — a sentence card is practised up a ladder from reading it aloud to saying it with no hints, and every attempt is scored on the spot.

This repository is an **excerpt** of the part that decides whether one spoken attempt passes. It is the piece where an LLM's judgment meets deterministic rules, and where most of the hard lessons were.

> Full project, for scale: TypeScript monorepo (Fastify + Prisma/Postgres backend, Expo/React Native app, shared contract package), ~1,700 commits since July 2026, ~45k lines of backend source, ~190 test files and ~60 eval scripts. Everything outside the scoring path is left out here — curriculum and learner-state models, listening/reading/conversation modes, content generation, the app.

---

## The problem

Scoring a spoken sentence needs two very different kinds of judgment:

- **Fluency** — was it said at a natural pace? This is measurable from timestamps.
- **Accuracy** — did it mean the right thing, hold together as English, and use the grammar the card trains? This needs language understanding.

The tempting design is to send everything to one LLM and ask "pass or fail?". That makes the score irreproducible, hides *why* an attempt failed, lets timing be judged by a model that never heard the audio, and puts the product's most important decision inside a prompt.

## Design: rules measure, the LLM judges, the engine decides

```
audio ──► STT (word timestamps) ──► deriveTiming ──► computeBand ─────────┐   rule: speed ratio → A / B / C
                     │                                                    │
                     └─► transcript text ──► judge (LLM, text only) ──────┤   verdict: meaning / grammar / construction
                                                                          ▼
                                                                    evaluateRep   engine: PASS = accuracy ∧ fluency
```

| | Owner | Why |
|---|---|---|
| Speed band | Rule ([`computeBand.ts`](src/engine/computeBand.ts)) | Reproducible, tunable from config, calibrated against labels |
| Accuracy verdict | LLM ([`claudeJudge.ts`](src/judge/claudeJudge.ts)) | Needs understanding — but sees **text only**, never audio or timing |
| PASS / fail and its reason | Engine ([`evaluateRep.ts`](src/engine/evaluateRep.ts)) | The model returns three test results; it never decides the outcome |

**Failure reasons have a fixed order** — meaning → grammar → construction → speed — so a garbage answer never gets "the meaning was right, just a bit slow", and speed is only judged once the content is right.

**Deterministic checks run before the LLM wherever they can:**
- Silence / almost nothing heard → *unscorable* (HTTP 422), not a failure. Recording it as a fail used to write a false meaning-error into the learner's history and push them down the ladder.
- Read-aloud steps have no judge, so a [coverage aligner](src/engine/coverage.ts) checks the sentence was actually said end to end — tolerant of plausible STT mishearings (*law → load*), not of different words (*law → bear*) or different numbers.
- Saying the reference sentence itself skips the judge entirely — any failure the model returned there would be noise.
- No English letters at all → deterministic fail, no API call.

## The judge: designing for asymmetric error costs

Most of the work was not the plumbing but *how the model should judge*. Dogfooding kept producing the same class of bug: correct sentences rejected for differing from the model answer. The root cause was the **grader frame** — asking "how far is this from the best answer?". The [rubric](src/judge/rubric.ts) replaces it with three **operational tests**:

1. **Meaning — the listener test.** Would a native friend understand the same situation? Awkward ≠ wrong.
2. **Grammar — the well-formedness test.** Does it hold together without reconstruction? Prescriptive slips are *minor*, not failures.
3. **Construction — a detection test, not classification.** Is the target form on the surface? To say *no*, the model must be able to state concretely where it is missing.

and three rules derived from real mis-grades:

- **Rejecting wrongly costs far more than passing wrongly**, so uncertainty resolves to pass.
- **The reference answer can justify a pass, never a fail.** It also *calibrates* the construction test: if the reference itself doesn't use the auxiliary the textbook rule names, the learner can't be required to.
- **The transcript is the transcriber's guess.** A whole word that is out of place and sounds like the right one is a mishearing, not the learner's error — but inflection, agreement and articles are preserved by STT, so those errors stay the learner's and must still be reported (they feed the weakness ledger).

The model's output is never trusted on shape alone: structured output → [runtime validation](src/contracts.ts) → [label sanitisation](src/judge/claudeJudge.ts) against closed lists of issue kinds and grounds ("differs from the reference" is deliberately not a ground).

## Evaluation

Every rule above exists because of a case in [`eval/cases.ts`](eval/cases.ts) — mostly real mis-grades frozen as regressions, each paired with a neighbour that must still fail (the mishearing rescue must not turn into general leniency; the reference must not make the judge soft).

```bash
npm run eval:band    # offline: Band accuracy, confusion matrix, grid sweep over thresholds and knobs
npm run eval:judge   # real model: label agreement, fail-reason agreement, p50/p95 latency (needs ANTHROPIC_API_KEY)
```

The judge eval runs the production path (same fast paths, same gate order), and checks more than pass/fail: a case can require that the grammar axis isn't laundered to `ok`, or that a natural paraphrase produces *no* issue labels. The excerpt carries 28 of the 57 judge cases.

The Band eval is honest about its state: the labels are placeholders, the default knobs score 80% on them (pause-count and latency limits are off by default), and the sweep shows which settings the labels would prefer. Replacing the placeholders with human-rated attempts is what turns it into a real calibration.

## Run it

Zero runtime dependencies. Node ≥ 22.18 runs the TypeScript directly.

```bash
npm test              # 17 tests: timing, band, coverage, gate order, fast paths, judge contract (judge is stubbed)
npm run eval:band
npm install && npm run typecheck   # optional: TypeScript is only a dev dependency
```

## Layout

```
src/contracts.ts           types crossing the rule / LLM / engine boundaries + verdict validation
src/config.ts              scoring knobs (env-overridable)
src/engine/
  timing.ts                word timestamps → latency, pauses, duration
  computeBand.ts           speed ratio → Band (rule)
  coverage.ts              read-aloud coverage with STT-tolerant alignment
  gates.ts                 which gates apply to which step; reference fast path
  evaluateRep.ts           composes PASS from the two gates
src/judge/
  rubric.ts                condensed production rubric
  claudeJudge.ts           Messages API call, JSON schema, issue sanitisation
eval/                      labelled cases + harness
test/                      node:test suites
```

**What was simplified for this excerpt:** the rubric is condensed and English-only (production is per-language and also handles writing, explanation depth and word-pair records); the issue-kind list is shortened; coverage drops multi-pass alignment and highlight marks; spelling checks for written answers (dictionary + a separate existence oracle) are omitted.

---

© 2026 MinChan Lee. Published for review as part of a portfolio; not licensed for reuse.
