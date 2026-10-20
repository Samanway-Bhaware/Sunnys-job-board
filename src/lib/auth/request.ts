/**
 * Identifying the caller for rate-limiting purposes.
 *
 * Honest limitation: `x-forwarded-for` is set by whatever sits in front of the
 * app and is trivially spoofable if the app is ever exposed directly. Behind
 * Railway / Fly.io (the documented deploy targets) the edge rewrites it, so it is
 * trustworthy there. For a single-user private site the residual risk is that a
 * determined attacker rotating the header gets more than 5 password guesses per
 * 15 minutes — the password itself remains the real control. Revisit in Phase 6
 * if the app is ever fronted by something that does not normalise this header.
 */
export function clientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}
