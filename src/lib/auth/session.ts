import { createHmac, timingSafeEqual } from "node:crypto";
import { decodeSecretBytes, getEnv, isProduction } from "@/lib/env";
import { passwordFingerprint } from "./password";

export const SESSION_COOKIE_NAME = "sunnynunny_session";

/**
 * 400 days is the browser cap on cookie lifetime (Chrome and Safari clamp
 * anything longer). The cookie is re-issued on every authenticated request, so
 * it slides forward and, in practice, never expires while she keeps visiting.
 */
export const SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

const SESSION_VERSION = 1;

interface SessionPayload {
  v: number;
  /** Fingerprint of the SITE_PASSWORD this session was issued under. */
  pf: string;
  /** Issued-at, ms since epoch. */
  iat: number;
}

function b64urlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payloadPart: string): string {
  const key = decodeSecretBytes(getEnv().APP_SECRET);
  return createHmac("sha256", key).update(payloadPart, "utf8").digest("base64url");
}

/** Mints a signed session token bound to the current SITE_PASSWORD. */
export function createSessionToken(now: number = Date.now()): string {
  const payload: SessionPayload = { v: SESSION_VERSION, pf: passwordFingerprint(), iat: now };
  const payloadPart = b64urlEncode(JSON.stringify(payload));
  return `${payloadPart}.${sign(payloadPart)}`;
}

/**
 * Verifies a session token. Returns false — never throws — for anything
 * malformed, so a corrupted or hand-edited cookie is simply "not signed in".
 *
 * There is no server-side session state, so a valid cookie keeps working across
 * server restarts and redeploys: the signature depends only on APP_SECRET.
 */
export function verifySessionToken(
  token: string | undefined | null,
  now: number = Date.now(),
): boolean {
  if (!token) return false;

  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) return false;

  const payloadPart = token.slice(0, separator);
  const signaturePart = token.slice(separator + 1);

  const expected = Buffer.from(sign(payloadPart), "utf8");
  const provided = Buffer.from(signaturePart, "utf8");
  if (expected.length !== provided.length) return false;
  if (!timingSafeEqual(expected, provided)) return false;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return false;
  }

  if (payload?.v !== SESSION_VERSION) return false;
  if (typeof payload.iat !== "number" || !Number.isFinite(payload.iat)) return false;
  if (now - payload.iat > SESSION_MAX_AGE_MS) return false;
  // Reject a cookie minted in the future beyond a minute of clock skew.
  if (payload.iat - now > 60_000) return false;

  // The decisive check: a cookie issued under a previous SITE_PASSWORD no longer
  // matches the current fingerprint, so changing the password signs everyone out.
  if (typeof payload.pf !== "string") return false;
  const currentFingerprint = Buffer.from(passwordFingerprint(), "utf8");
  const cookieFingerprint = Buffer.from(payload.pf, "utf8");
  if (currentFingerprint.length !== cookieFingerprint.length) return false;
  return timingSafeEqual(currentFingerprint, cookieFingerprint);
}

export interface SessionCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

export function sessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

export function clearedSessionCookieOptions(): SessionCookieOptions {
  return { ...sessionCookieOptions(), maxAge: 0 };
}
