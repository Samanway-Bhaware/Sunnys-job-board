import { orgTokens } from "./normalise";

/**
 * Conservative fuzzy matching (brief 2.7): exact normalised match first, then a
 * token-set similarity of at least 0.92.
 *
 * "Token-set similarity" here is the standard token_set_ratio: sort the tokens,
 * take the intersection, and compare the intersection against each side's
 * remainder with a normalised longest-common-subsequence ratio. On its own that
 * scores 1.0 whenever one name's tokens are a subset of the other's, which would
 * make "Playhouse" match "Playhouse Nursery Ltd". Two guards fix that:
 *   - the shared tokens must number at least two (or the whole of a one-token name)
 *   - they must cover at least 80% of the longer name
 *   - single letters and connectives ("and", "of", …) don't count as shared: on the
 *     live register "V&A Dundee" matched "A&M Dundee Ltd" on {a, and, dundee}
 *   - generic organisation words ("society", "company", "workshop", …) don't count
 *     *against* coverage, and neither does the register row's own town:
 *     "Edinburgh International Festival" is the Festival Society (3 of 3
 *     distinctive tokens) and not the Book Festival (3 of 4); "Northern Ballet
 *     School" is "Northern Ballet School Leeds" when that row's town is Leeds
 *
 * 70% rather than 60% because token sets ignore word order: at 60%, "Theatre
 * Royal" (2 tokens) fuzzy-matched "Royal Lyceum Theatre" (3 tokens) — two common
 * words covering two-thirds of a different organisation's name. At 70% a 2-token
 * name can only fuzzy-match a 2-token name, and a 3-token name needs 3 of 4.
 * "Edinburgh Printmakers" therefore does not fuzzy-match "Edinburgh Printmakers
 * Workshop" (2 of 3) — that is the conservative side of the trade, and the exact
 * match still catches it whenever the listing carries the full name.
 */

export const FUZZY_THRESHOLD = 0.92;
const MIN_SHARED_TOKENS = 2;
const MIN_COVERAGE = 0.8;
const WEAK = new Set(["and", "of", "for", "in", "at", "on"]);

/** Words that describe what kind of body it is, not which one. */
const GENERIC = new Set([
  "society", "company", "group", "workshop", "enterprise", "enterprises", "foundation",
  "association", "organisation", "organization", "services", "service", "centre", "center",
  "studio", "studios", "collective", "partnership", "partners", "ventures", "holdings", "charity",
]);

/** Tokens that can carry identity: not a single letter, not a connective. */
export function strongTokens(name: string): string[] {
  return orgTokens(name).filter((t) => t.length > 1 && !WEAK.has(t));
}

/**
 * Strong tokens minus generic organisation words (and, for a register row, its
 * own town) — the ones that distinguish one body from another.
 */
export function distinctiveTokens(name: string, town = ""): string[] {
  const townTokens = new Set(orgTokens(town));
  const strong = strongTokens(name);
  const distinctive = strong.filter((t) => !GENERIC.has(t) && !townTokens.has(t));
  return distinctive.length > 0 ? distinctive : strong;
}

function lcsLength(a: string, b: string): number {
  if (!a || !b) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** 2·LCS / (|a| + |b|) — the "ratio" used by rapidfuzz-style matchers. */
export function stringRatio(a: string, b: string): number {
  if (a === b) return 1;
  const total = a.length + b.length;
  return total === 0 ? 1 : (2 * lcsLength(a, b)) / total;
}

export interface Similarity {
  score: number;
  shared: number;
  coverage: number;
}

/** `b` is the register side; `townB` its Town/City column. */
export function tokenSetSimilarity(a: string, b: string, townB = ""): Similarity {
  const ta = new Set(orgTokens(a));
  const tb = new Set(orgTokens(b));
  if (ta.size === 0 || tb.size === 0) return { score: 0, shared: 0, coverage: 0 };

  const inter = [...ta].filter((t) => tb.has(t)).sort();
  const restA = [...ta].filter((t) => !tb.has(t)).sort();
  const restB = [...tb].filter((t) => !ta.has(t)).sort();

  const t0 = inter.join(" ");
  const t1 = [...inter, ...restA].join(" ");
  const t2 = [...inter, ...restB].join(" ");
  const score = Math.max(stringRatio(t0, t1), stringRatio(t0, t2), stringRatio(t1, t2));

  // Shared-ness and coverage are judged on tokens that distinguish organisations.
  const sa = new Set(distinctiveTokens(a, townB));
  const sb = new Set(distinctiveTokens(b, townB));
  const shared = [...sa].filter((t) => sb.has(t)).length;
  const max = Math.max(sa.size, sb.size);

  return { score, shared, coverage: max === 0 ? 0 : shared / max };
}

/** True if `a` and `b` are the same organisation under the conservative rule. */
export function isFuzzyMatch(a: string, b: string, townB = ""): boolean {
  const { score, shared, coverage } = tokenSetSimilarity(a, b, townB);
  if (score < FUZZY_THRESHOLD) return false;
  // A name with one distinctive token can only ever match exactly.
  if (shared < MIN_SHARED_TOKENS) return false;
  return coverage >= MIN_COVERAGE;
}
