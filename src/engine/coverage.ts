/**
 * Read-aloud coverage — "did the learner actually say the sentence, start to finish?"
 *
 * Read steps have no accuracy judge (the words are on screen), so without this gate a learner
 * could read half the sentence, or say something else quickly, and still pass on speed.
 * The gate measures whether the words were said, not pronunciation quality, so it has to be
 * tolerant of STT mistakes without becoming a hole:
 *
 *  1. Order-preserving alignment (LCS over words) with a conservative fuzzy match
 *     (edit distance ≤ 1, or ≤ 2 for words of 7+ letters; never for words under 4 letters).
 *  2. Substitution credit: a spoken word that sits 1:1 between two aligned anchors, in the slot of
 *     an unmatched target word, and *sounds plausibly like it* (edit distance ≤ half the longer word),
 *     is most likely the transcriber mishearing — e.g. "law" → "load". It earns credit; "law" → "bear" does not.
 *  3. Numbers are never fuzzy or credited — reading a different date or amount is a content error.
 *  4. Fillers are not evidence of reading, and total credit is capped (15% of target words, min 1).
 */

const FILLERS = new Set(["um", "uh", "er", "ah", "hmm", "mm", "uhm"]);
const MAX_SUB_CREDIT_RATIO = 0.15;

export interface CoverageInfo {
  /** 0..1 — share of scored target words aligned in order (matches + substitution credit) */
  ratio: number;
  /** was the last target word part of the alignment? */
  lastWordSpoken: boolean;
  /** number of scored target words (the ratio's denominator) */
  scored: number;
}

const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);

const isNumeric = (w: string): boolean => /\d/.test(w);

export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

export function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (isNumeric(a) || isNumeric(b)) return false;
  if (Math.min(a.length, b.length) < 4) return false;
  return editDistance(a, b) <= (Math.max(a.length, b.length) >= 7 ? 2 : 1);
}

const plausibleSubstitution = (said: string, target: string): boolean =>
  !isNumeric(said) && !isNumeric(target) && !FILLERS.has(said) &&
  editDistance(said, target) <= Math.floor(Math.max(said.length, target.length) / 2);

export function coverageInfo(spoken: string, target: string, unscored: readonly string[] = []): CoverageInfo {
  const skip = new Set(unscored.map((w) => w.toLowerCase()));
  const t = tokenize(target).filter((w) => !skip.has(w));
  const s = tokenize(spoken);
  if (t.length === 0) return { ratio: 0, lastWordSpoken: false, scored: 0 };
  if (s.length === 0) return { ratio: 0, lastWordSpoken: false, scored: t.length };

  const n = s.length;
  const m = t.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i]![j] = wordsMatch(s[i - 1]!, t[j - 1]!) ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }
  const matched = dp[n]![m]!;
  const lastWordSpoken = matched > dp[n]![m - 1]!;

  // Recover anchors (aligned [spoken, target] pairs), earliest occurrence on ties.
  const anchors: Array<[number, number]> = [];
  for (let i = n, j = m; i > 0 && j > 0; ) {
    if (dp[i]![j] === dp[i]![j - 1]) j--;
    else if (dp[i]![j] === dp[i - 1]![j]) i--;
    else {
      anchors.push([i - 1, j - 1]);
      i--;
      j--;
    }
  }
  anchors.reverse();

  // Substitution credit: exactly one spoken word and one target word between consecutive anchors
  // (or between an anchor and the sentence edge).
  let credit = 0;
  const cap = Math.max(1, Math.floor(m * MAX_SUB_CREDIT_RATIO));
  const bounds: Array<[number, number]> = [[-1, -1], ...anchors, [n, m]];
  for (let k = 1; k < bounds.length && credit < cap; k++) {
    const [si, ti] = bounds[k - 1]!;
    const [sj, tj] = bounds[k]!;
    if (sj - si === 2 && tj - ti === 2 && plausibleSubstitution(s[si + 1]!, t[ti + 1]!)) credit++;
  }

  return { ratio: Math.min(1, (matched + credit) / m), lastWordSpoken, scored: m };
}
