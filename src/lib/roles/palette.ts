/**
 * Role tab colours. The first six are byte-identical to the prototype's
 * CAT_COLORS so the seeded roles look exactly as designed; four more in the same
 * muted register cover the brief's cap of 10 roles (RECONCILE #8).
 */
export const ROLE_PALETTE = [
  "#6D4AA0",
  "#A86A12",
  "#1F7A6D",
  "#2F5DA8",
  "#9B3D6B",
  "#4B6B2A",
  "#B04F2C",
  "#2B7A8C",
  "#8A6A1E",
  "#5E5B9C",
] as const;

/** First palette colour not already in use; cycles once the palette is exhausted. */
export function nextColor(inUse: readonly string[]): string {
  const used = new Set(inUse.map((c) => c.toUpperCase()));
  const free = ROLE_PALETTE.find((c) => !used.has(c));
  return free ?? ROLE_PALETTE[inUse.length % ROLE_PALETTE.length]!;
}
