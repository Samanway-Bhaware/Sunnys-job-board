import { createHmac, timingSafeEqual } from "node:crypto";
import { decodeSecretBytes, getEnv } from "@/lib/env";

/**
 * Password handling.
 *
 * The real SITE_PASSWORD never leaves this module, is never logged, and is never
 * compared byte-by-byte against user input. Comparison is done on fixed-length
 * HMACs so it is constant time with respect to both content and length.
 */

function hmacHex(label: string, value: string): string {
  const key = decodeSecretBytes(getEnv().APP_SECRET);
  return createHmac("sha256", key).update(`${label}|${value}`, "utf8").digest("hex");
}

/**
 * A stable fingerprint of the *current* SITE_PASSWORD, embedded in every session
 * cookie. Changing SITE_PASSWORD changes the fingerprint, which invalidates every
 * cookie already issued — that is how "changing the password signs out every
 * device" is implemented, with no server-side session store.
 *
 * It is an HMAC under APP_SECRET, so the cookie never carries anything that could
 * be used to brute-force the password offline without also having APP_SECRET.
 */
export function passwordFingerprint(): string {
  return hmacHex("pwfp:v1", getEnv().SITE_PASSWORD).slice(0, 32);
}

/** Timing-safe check of a candidate password against SITE_PASSWORD. */
export function verifyPassword(candidate: string): boolean {
  if (typeof candidate !== "string" || candidate.length === 0) return false;

  // Both sides are 32-byte digests, so timingSafeEqual never throws on length
  // and the comparison leaks nothing about the real password's length.
  const provided = Buffer.from(hmacHex("pwcheck:v1", candidate), "hex");
  const expected = Buffer.from(hmacHex("pwcheck:v1", getEnv().SITE_PASSWORD), "hex");
  return timingSafeEqual(provided, expected);
}
