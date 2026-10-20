import { eq } from "drizzle-orm";
import { currentDbTarget, getDb, getDbState } from "@/lib/db";
import { ensureMigrated } from "@/lib/db/migrate-runtime";
import { meta, roles } from "@/lib/db/schema";
import { createRole } from "@/lib/roles";
import { ensureSettings } from "@/lib/settings";

const SEEDED_KEY = "seeded_roles_v1";

/** Brief section 2.2: seed three roles. */
export const SEED_ROLES = [
  { name: "Communications", keywords: "PR, press, internal communications, content" },
  { name: "Marketing", keywords: "digital marketing, social media, audience development, campaigns" },
  { name: "Business development", keywords: "partnerships, fundraising, sponsorship, sales" },
] as const;

/**
 * Idempotent. Runs at every server start. The seed-roles marker means that if
 * she later deletes all three, they do not come back on the next restart.
 */
export async function seedDatabase(now: number = Date.now()): Promise<void> {
  const db = getDb();
  await ensureSettings(now);

  const markerRows = await db.select().from(meta).where(eq(meta.key, SEEDED_KEY));
  if (markerRows[0]) return;

  const anyRoleRows = await db.select({ id: roles.id }).from(roles);
  if (anyRoleRows.length === 0) {
    for (let index = 0; index < SEED_ROLES.length; index += 1) {
      await createRole(SEED_ROLES[index]!, now + index);
    }
  }

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
