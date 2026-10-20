import { eq } from "drizzle-orm";
import { currentDbTarget, getDb, getDbState, type Db } from "@/lib/db";
import { ensureMigrated } from "@/lib/db/migrate-runtime";
import { jobs, meta, roles } from "@/lib/db/schema";
import { createRole } from "@/lib/roles";
import { ensureSettings } from "@/lib/settings";

const SEEDED_KEY = "seeded_roles_v1";

/** Brief section 2.2: seed three roles. */
export const SEED_ROLES = [
  { name: "Communications", keywords: "PR, press, internal communications, content" },
  { name: "Marketing", keywords: "digital marketing, social media, audience development, campaigns" },
  { name: "Business development", keywords: "partnerships, fundraising, sponsorship, sales" },
] as const;

async function deduplicateRoles(db: Db): Promise<void> {
  const allRoles = await db.select().from(roles).orderBy(roles.createdAt);
  const seen = new Map<string, string>();
  for (const r of allRoles) {
    const key = r.name.trim().toLowerCase();
    const existingId = seen.get(key);
    if (!existingId) {
      seen.set(key, r.id);
    } else {
      await db.update(jobs).set({ roleId: existingId }).where(eq(jobs.roleId, r.id));
      await db.delete(roles).where(eq(roles.id, r.id));
    }
  }
}

/**
 * Idempotent. Runs at every server start. The seed-roles marker means that if
 * she later deletes all three, they do not come back on the next restart.
 */
export async function seedDatabase(now: number = Date.now()): Promise<void> {
  const db = getDb();
  await ensureSettings(now);

  const markerRows = await db.select().from(meta).where(eq(meta.key, SEEDED_KEY));
  if (markerRows[0]) {
    await deduplicateRoles(db);
    return;
  }

  const anyRoleRows = await db.select({ id: roles.id }).from(roles);
  if (anyRoleRows.length === 0) {
    for (let index = 0; index < SEED_ROLES.length; index += 1) {
      await createRole(SEED_ROLES[index]!, now + index);
    }
  }

  await deduplicateRoles(db);
  await db.insert(meta).values({ key: SEEDED_KEY, value: String(now) }).onConflictDoNothing();
  getDbState().seededTarget = currentDbTarget();
}

export async function ensureSeeded(): Promise<void> {
  await ensureMigrated();
  const state = getDbState();
  const target = currentDbTarget();
  if (state.seededTarget === target) return;
  if (!state.seedPromise) {
    state.seedPromise = seedDatabase().finally(() => {
      state.seedPromise = null;
    });
  }
  await state.seedPromise;
}
