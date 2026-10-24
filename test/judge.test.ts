import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVerdict } from "../src/contracts.ts";
import { createClaudeJudge, sanitizeIssues } from "../src/judge/claudeJudge.ts";
import { buildUserText } from "../src/judge/rubric.ts";

const base = { meaning: "pass", grammar: "minor", construction_used: true, ment: "좋아요" } as const;

test("parseVerdict rejects values outside the contract", () => {
  assert.throws(() => parseVerdict({ ...base, grammar: "bad", issues: [] }));
  assert.throws(() => parseVerdict({ ...base, construction_used: "yes", issues: [] }));
});

test("sanitizeIssues drops unknown kinds/grounds, empty notes and duplicate kinds", () => {
  const v = sanitizeIssues({
    ...base,
    issues: [
      { kind: "article", grounds: "ill_formed", note: "a 누락" },
      { kind: "article", grounds: "ill_formed", note: "duplicate" },
      { kind: "style" as never, grounds: "ill_formed", note: "not in the list" },
      { kind: "tense", grounds: "differs_from_reference" as never, note: "not a ground" },
      { kind: "preposition", grounds: "misleads_listener", note: "  " },
    ],
  });
  assert.deepEqual(v.issues.map((i) => i.kind), ["article"]);
});

test("judge: no English in the transcript is a deterministic fail without an API call", async () => {
  let called = false;
  const judge = createClaudeJudge({ apiKey: "x", fetchImpl: (async () => { called = true; throw new Error("no"); }) as typeof fetch });
  const v = await judge({ targetKo: "안녕", construction: { name: "x", detect_rule: "x" }, transcript: "ㅏㅏㅏ", modality: "speech" });
  assert.equal(v.meaning, "fail");
  assert.equal(called, false);
});

test("judge: sends rubric as cached system prefix, item data in the user turn, and validates the reply", async () => {
  let sent: any;
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    sent = JSON.parse(init.body as string);
    const reply = { ...base, issues: [{ kind: "article", grounds: "ill_formed", note: "관사" }, { kind: "nope", grounds: "ill_formed", note: "x" }] };
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(reply) }] }), { status: 200 });
  }) as typeof fetch;
  const judge = createClaudeJudge({ apiKey: "k", model: "m", fetchImpl: fakeFetch });
  const input = { targetKo: "카페 있어?", construction: { name: "n", detect_rule: "r" }, transcript: "Is there cafe?", modality: "speech" as const, reference: "Is there a cafe?" };
  const v = await judge(input);
  assert.equal(sent.system[0].cache_control.type, "ephemeral");
  assert.equal(sent.messages[0].content, buildUserText(input));
  assert.equal(sent.output_config.format.type, "json_schema");
  assert.deepEqual(v.issues.map((i) => i.kind), ["article"]);
});
