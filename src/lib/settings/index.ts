import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { settings, type SettingsRow } from "@/lib/db/schema";
import type { ScopeView } from "@/lib/jobs/types";

/** Brief section 2.3 defaults. */
export const DEFAULT_SCOPE: ScopeView = {
  sector: "",
  locations: ["Remote (UK)", "Edinburgh"],
  notes: "Prefers part-time, 2 to 3 days a week. Full-time roles in Edinburgh are also fine.",
};

const SETTINGS_ID = 1;

export function ensureSettings(now: number = Date.now()): SettingsRow {
  const db = getDb();
  const existing = db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get();
  if (existing) return existing;

  db.insert(settings)
    .values({
      id: SETTINGS_ID,
      sector: DEFAULT_SCOPE.sector,
      locations: JSON.stringify(DEFAULT_SCOPE.locations),
      notes: DEFAULT_SCOPE.notes,
      provider: "scrapers",
      model: null,
      seenUpTo: null,
      lastRefreshAt: null,
      updatedAt: now,
    })
    .run();

  return db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).get()!;
}

export function getSettings(): SettingsRow {
  return ensureSettings();
}

export function parseLocations(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function getScope(): ScopeView {
  const row = getSettings();
  return { sector: row.sector, locations: parseLocations(row.locations), notes: row.notes };
}

export function updateScope(scope: ScopeView, now: number = Date.now()): ScopeView {
  ensureSettings(now);
  getDb()
    .update(settings)
    .set({
      sector: scope.sector,
      locations: JSON.stringify(scope.locations),
      notes: scope.notes,
      updatedAt: now,
    })
    .where(eq(settings.id, SETTINGS_ID))
    .run();
  return getScope();
}

export function setProviderAndModel(provider: string, model: string | null, now = Date.now()): void {
  ensureSettings(now);
  getDb()
    .update(settings)
    .set({ provider, model, updatedAt: now })
    .where(eq(settings.id, SETTINGS_ID))
    .run();
}

/** Called when a refresh completes: the next visit's "New" badges are measured from here. */
export function markRefreshCompleted(finishedAt: number): void {
  ensureSettings(finishedAt);
  getDb()
    .update(settings)
    .set({ seenUpTo: finishedAt, lastRefreshAt: finishedAt, updatedAt: finishedAt })
    .where(eq(settings.id, SETTINGS_ID))
    .run();
}
