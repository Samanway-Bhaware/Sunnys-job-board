import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { loginAttempts } from "@/lib/db/schema";

/** Brief section 2.1: 5 failures per 15 minutes per IP, then 429. */
export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;

export interface RateLimitState {
  allowed: boolean;
  failures: number;
  /** Seconds until the oldest failure in the window ages out. 0 when allowed. */
  retryAfterSeconds: number;
}

function windowStart(now: number): number {
  return now - WINDOW_MS;
}

/** Whether this IP may attempt a login right now. Does not record anything. */
export function checkRateLimit(ip: string, now: number = Date.now()): RateLimitState {
  const db = getDb();
  const since = windowStart(now);

  const rows = db
    .select({ attemptedAt: loginAttempts.attemptedAt })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), gte(loginAttempts.attemptedAt, since)))
    .orderBy(loginAttempts.attemptedAt)
    .all();

  const failures = rows.length;
  if (failures < MAX_FAILURES) {
    return { allowed: true, failures, retryAfterSeconds: 0 };
  }

  // Blocked until the oldest failure in the window falls out of it.
  const oldest = rows[0]?.attemptedAt ?? now;
  const retryAfterMs = Math.max(0, oldest + WINDOW_MS - now);
  return {
    allowed: false,
    failures,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  };
}

export function recordFailure(ip: string, now: number = Date.now()): void {
  const db = getDb();
  db.insert(loginAttempts).values({ ip, attemptedAt: now }).run();

  // Opportunistic cleanup so the table cannot grow without bound.
  db.delete(loginAttempts)
    .where(sql`${loginAttempts.attemptedAt} < ${windowStart(now)}`)
    .run();
}

/** A correct password clears that IP's failure history. */
export function clearFailures(ip: string): void {
  getDb().delete(loginAttempts).where(eq(loginAttempts.ip, ip)).run();
}

function waitPhrase(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return minutes <= 1 ? "about a minute" : `about ${minutes} minutes`;
}

/**
 * Plain-language messages (brief section 2.10: say what happened and what to do
 * next). Neither message reveals whether the attempted password was close.
 */

/** Shown when an attempt is refused before the password is even checked. */
export function rateLimitMessage(retryAfterSeconds: number): string {
  return `Too many attempts. Try again in ${waitPhrase(retryAfterSeconds)}.`;
}

/** Shown on the failure that uses up the last allowed attempt. */
export function lockoutAfterFailureMessage(retryAfterSeconds: number): string {
  return (
    `That password isn't right, and that was the last attempt for now. ` +
    `Try again in ${waitPhrase(retryAfterSeconds)}.`
  );
}
