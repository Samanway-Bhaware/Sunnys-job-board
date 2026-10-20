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

export async function ensureSettings(now: number = Date.now()): Promise<SettingsRow> {
  const db = getDb();
  const existing = (await db.select().from(settings).where(eq(settings.id, SETTINGS_ID)))[0];
  if (existing) return existing;

  await db
    .insert(settings)
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
    .onConflictDoNothing();

  const row = (await db.select().from(settings).where(eq(settings.id, SETTINGS_ID)))[0];
  return row!;
}

export async function getSettings(): Promise<SettingsRow> {
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

export async function getScope(): Promise<ScopeView> {
  const row = await getSettings();
  return { sector: row.sector, locations: parseLocations(row.locations), notes: row.notes };
}

export async function updateScope(scope: ScopeView, now: number = Date.now()): Promise<ScopeView> {
  await ensureSettings(now);
  await getDb()
    .update(settings)
    .set({
      sector: scope.sector,
      locations: JSON.stringify(scope.locations),
      notes: scope.notes,
      updatedAt: now,
    })
    .where(eq(settings.id, SETTINGS_ID));
  return getScope();
}

export async function setProviderAndModel(provider: string, model: string | null, now = Date.now()): Promise<void> {
  await ensureSettings(now);
  await getDb()
    .update(settings)
    .set({ provider, model, updatedAt: now })
    .where(eq(settings.id, SETTINGS_ID));
}

/** Called when a refresh completes: the next visit's "New" badges are measured from here. */
export async function markRefreshCompleted(finishedAt: number): Promise<void> {
  await ensureSettings(finishedAt);
  await getDb()
    .update(settings)
    .set({ seenUpTo: finishedAt, lastRefreshAt: finishedAt, updatedAt: finishedAt })
    .where(eq(settings.id, SETTINGS_ID));
}
