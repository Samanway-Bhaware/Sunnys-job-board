import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { meta, refreshRuns } from "@/lib/db/schema";
import { todayString } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { getSettings } from "@/lib/settings";

/**
 * Scraper refresh policy:
 *   - cooldown: a "visit" refresh runs only if the last success is older than
 *     REFRESH_COOLDOWN_MINUTES (0 = always). "manual" bypasses it.
 *   - lock: one run at a time, DB-backed, stale after 10 minutes.
 *   - scraping is free, so daily cap is uncapped.
 */

export const LOCK_STALE_MS = 10 * 60 * 1000;
const LOCK_KEY = "refresh_lock";

export interface UsageView {
  date: string;
  used: number;
  cap: number;
  applies: boolean;
}

export function cooldownMs(): number {
  return getEnv().REFRESH_COOLDOWN_MINUTES * 60 * 1000;
}

/** Ms until a "visit" refresh is allowed again; 0 when it may run now. */
export function cooldownRemaining(now: number = Date.now()): number {
  const last = getSettings().lastRefreshAt;
  if (!last) return 0;
  return Math.max(0, last + cooldownMs() - now);
}

export function usageFor(_provider = "scrapers", _usesDefaultKey = false, now: number = Date.now()): UsageView {
  const date = todayString(now);
  return { date, used: 0, cap: 999999, applies: false };
}

export function capReached(_provider = "scrapers", _usesDefaultKey = false, _now: number = Date.now()): boolean {
  return false;
}

export function recordUsage(_provider: string, _delta: { runs?: number; calls?: number }, _now: number = Date.now()): void {
  // Free scrapers have no token tracking
}

interface Lock {
  runId: string;
  at: number;
}

function readLock(): Lock | null {
  const row = getDb().select().from(meta).where(eq(meta.key, LOCK_KEY)).get();
  if (!row) return null;
  try {
    return JSON.parse(row.value) as Lock;
  } catch {
    return null;
  }
}

export function acquireLock(runId: string, now: number = Date.now()): { acquired: true } | { acquired: false; heldBy: string } {
  const db = getDb();
  return db.transaction((tx) => {
    const row = tx.select().from(meta).where(eq(meta.key, LOCK_KEY)).get();
    let current: Lock | null = null;
    if (row) {
      try {
        current = JSON.parse(row.value) as Lock;
      } catch {
        current = null;
      }
    }

    if (current) {
      const holder = tx.select().from(refreshRuns).where(eq(refreshRuns.id, current.runId)).get();
      const stillRunning = holder?.status === "running";
      const stale = now - current.at >= LOCK_STALE_MS;
      if (stillRunning && !stale) return { acquired: false, heldBy: current.runId };
      if (stillRunning && stale) {
        tx.update(refreshRuns)
          .set({ status: "failed", error: "Stopped after 10 minutes without finishing.", finishedAt: now })
          .where(eq(refreshRuns.id, current.runId))
          .run();
      }
    }

    const value = JSON.stringify({ runId, at: now } satisfies Lock);
    tx.insert(meta).values({ key: LOCK_KEY, value }).onConflictDoUpdate({ target: meta.key, set: { value } }).run();
    return { acquired: true };
  });
}

export function releaseLock(runId: string): void {
  const current = readLock();
  if (current?.runId === runId) getDb().delete(meta).where(eq(meta.key, LOCK_KEY)).run();
}

export function lockHolder(): string | null {
  return readLock()?.runId ?? null;
}
