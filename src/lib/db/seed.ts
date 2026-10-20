import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
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
export function seedDatabase(now: number = Date.now()): void {
  const db = getDb();
  ensureSettings(now);

  const marker = db.select().from(meta).where(eq(meta.key, SEEDED_KEY)).get();
  if (marker) return;

  const anyRole = db.select({ id: roles.id }).from(roles).get();
  if (!anyRole) {
    SEED_ROLES.forEach((role, index) => createRole(role, now + index));
  }

  db.insert(meta).values({ key: SEEDED_KEY, value: String(now) }).run();
}
