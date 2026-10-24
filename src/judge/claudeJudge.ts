/**
 * LLM judge on the Anthropic Messages API (plain fetch, no SDK).
 *
 *  - Input is transcript text + target only. No audio, no timing.
 *  - Structured output (JSON schema) guarantees the shape; parseVerdict re-checks it; sanitizeIssues
 *    enforces the closed label set. Prompt compliance is never trusted on its own.
 *  - The rubric is a cached system prefix; per-item data goes in the user turn so the cache is shared.
 *  - Thinking stays on at low effort: this is a latency-sensitive path, but turning thinking off
 *    introduced other failure modes.
 */
import { ISSUE_GROUNDS, ISSUE_KINDS, parseVerdict } from "../contracts.ts";
import type { Issue, IssueGround, IssueKind, Judge, JudgeInput, Verdict } from "../contracts.ts";
import { RUBRIC, buildUserText } from "./rubric.ts";

export const VERDICT_JSON_SCHEMA = {
  type: "object",
  properties: {
    meaning: { type: "string", enum: ["pass", "fail"] },
    grammar: { type: "string", enum: ["ok", "minor", "broken"] },
    construction_used: { type: "boolean" },
    ment: { type: "string" },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...ISSUE_KINDS] },
          grounds: { type: "string", enum: [...ISSUE_GROUNDS] },
          note: { type: "string" },
        },
        required: ["kind", "grounds", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["meaning", "grammar", "construction_used", "ment", "issues"],
  additionalProperties: false,
} as const;

const ISSUE_CAP = 6;

/** Drop labels outside the closed lists, ungrounded or empty notes, and duplicate kinds; cap the count. */
export function sanitizeIssues(v: Verdict): Verdict {
  const seen = new Set<string>();
  const issues: Issue[] = [];
  for (const it of v.issues ?? []) {
    const note = (it?.note ?? "").trim();
    if (!ISSUE_KINDS.includes(it?.kind as IssueKind) || !ISSUE_GROUNDS.includes(it?.grounds as IssueGround)) continue;
    if (!note || seen.has(it.kind)) continue;
    seen.add(it.kind);
    issues.push({ kind: it.kind, grounds: it.grounds, note });
    if (issues.length >= ISSUE_CAP) break;
  }
  return { ...v, issues };
}

/** No English at all ("ㅏㅏㅏ", Korean only) — a deterministic meaning fail, no LLM call. */
function notEnglish(transcript: string): Verdict | null {
  if (/[a-z]{2,}/i.test(transcript)) return null;
  return {
    meaning: "fail",
    grammar: "broken",
    construction_used: false,
    ment: "영어 문장이 들리지 않았어요. 영어로 다시 말해 볼까요?",
    issues: [],
  };
}

export interface ClaudeJudgeOptions {
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export function createClaudeJudge(opts: ClaudeJudgeOptions = {}): Judge {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const model = opts.model ?? process.env.JUDGE_MODEL ?? "claude-sonnet-5-5";
  const doFetch = opts.fetchImpl ?? fetch;

  return async (input: JudgeInput): Promise<Verdict> => {
    const quick = notEnglish(input.transcript);
    if (quick) return quick;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

    const res = await doFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model,
        // max_tokens covers thinking + output; too low and the JSON gets truncated mid-object.
        max_tokens: 4000,
        thinking: { type: "adaptive" },
        output_config: { effort: "low", format: { type: "json_schema", schema: VERDICT_JSON_SCHEMA } },
        system: [{ type: "text", text: RUBRIC, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: buildUserText(input) }],
      }),
    });
    if (!res.ok) throw new Error(`judge HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = body.content?.find((b) => b.type === "text")?.text;
    if (!text) throw new Error("judge returned no text block");
    return sanitizeIssues(parseVerdict(JSON.parse(text)));
  };
}
