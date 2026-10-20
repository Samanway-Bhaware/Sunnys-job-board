/**
 * Organisation-name normalisation for the sponsor register (brief 2.7):
 * lowercase, punctuation removed, corporate suffixes and articles dropped.
 * Applied identically to register rows and to listing organisations, so the
 * two sides are compared on the same footing.
 */

/** "ltd, limited, plc, the, cic, llp, trust and similar". */
const STOP_TOKENS = new Set([
  "ltd",
  "limited",
  "plc",
  "the",
  "cic",
  "cio",
  "scio",
  "llp",
  "lp",
  "llc",
  "inc",
  "incorporated",
  "trust",
  "co",
  "company",
  "uk",
]);

/** "X LTD T/A Y" → ["x", "y"]: both the legal and the trading name are indexed. */
const TRADING_AS = /\s+(?:t\/a|t\/as|trading as|ta)\s+/i;

export function orgTokens(name: string): string[] {
  const cleaned = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const tokens = cleaned.split(/\s+/).filter((t) => t && !STOP_TOKENS.has(t));
  return [...new Set(tokens)];
}

export function normaliseOrgName(name: string): string {
  return orgTokens(name).join(" ");
}

/** Every normalised form a register row should be findable under. */
export function registerAliases(name: string): string[] {
  const parts = name.split(TRADING_AS).map((p) => p.trim()).filter(Boolean);
  const forms = new Set<string>();
  for (const part of parts) {
    const norm = normaliseOrgName(part);
    if (norm) forms.add(norm);
  }
  if (forms.size === 0) {
    const whole = normaliseOrgName(name);
    if (whole) forms.add(whole);
  }
  return [...forms];
}
