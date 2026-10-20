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
export async function cooldownRemaining(now: number = Date.now()): Promise<number> {
  const settings = await getSettings();
  const last = settings.lastRefreshAt;
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

async function readLock(): Promise<Lock | null> {
  const rows = await getDb().select().from(meta).where(eq(meta.key, LOCK_KEY));
  const row = rows[0];
  if (!row) return null;
  try {
    return JSON.parse(row.value) as Lock;
  } catch {
    return null;
  }
}

export async function acquireLock(runId: string, now: number = Date.now()): Promise<{ acquired: true } | { acquired: false; heldBy: string }> {
  const db = getDb();
  const rows = await db.select().from(meta).where(eq(meta.key, LOCK_KEY));
  const row = rows[0];
  let current: Lock | null = null;
  if (row) {
    try {
      current = JSON.parse(row.value) as Lock;
    } catch {
      current = null;
    }
  }

  if (current) {
    const holderRows = await db.select().from(refreshRuns).where(eq(refreshRuns.id, current.runId));
    const holder = holderRows[0];
    const stillRunning = holder?.status === "running";
    const stale = now - current.at >= LOCK_STALE_MS;
    if (stillRunning && !stale) return { acquired: false, heldBy: current.runId };
    if (stillRunning && stale) {
      await db.update(refreshRuns)
        .set({ status: "failed", error: "Stopped after 10 minutes without finishing.", finishedAt: now })
        .where(eq(refreshRuns.id, current.runId));
    }
  }

  const value = JSON.stringify({ runId, at: now } satisfies Lock);
  await db.insert(meta).values({ key: LOCK_KEY, value }).onConflictDoUpdate({ target: meta.key, set: { value } });
  return { acquired: true };
}

export async function releaseLock(runId: string): Promise<void> {
  const current = await readLock();
  if (current?.runId === runId) await getDb().delete(meta).where(eq(meta.key, LOCK_KEY));
}

export async function lockHolder(): Promise<string | null> {
  const lock = await readLock();
  return lock?.runId ?? null;
}
