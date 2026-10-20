import { sql } from "drizzle-orm";
import { currentDbTarget, getDb, getDbState } from "./index";

const BOOTSTRAP_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "api_keys" (
    "provider" text PRIMARY KEY NOT NULL,
    "ciphertext" text NOT NULL,
    "iv" text NOT NULL,
    "tag" text NOT NULL,
    "last4" text NOT NULL,
    "updated_at" bigint NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "roles" (
    "id" text PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "keywords" text DEFAULT '' NOT NULL,
    "color" text NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "sort_order" integer NOT NULL,
    "archived" boolean DEFAULT false NOT NULL,
    "created_at" bigint NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "jobs" (
    "id" text PRIMARY KEY NOT NULL,
    "role_id" text NOT NULL REFERENCES "roles"("id") ON DELETE cascade,
    "title" text NOT NULL,
    "org" text NOT NULL,
    "location_text" text DEFAULT '' NOT NULL,
    "location_norm" text DEFAULT '' NOT NULL,
    "work_mode" text DEFAULT 'unknown' NOT NULL,
    "contract" text DEFAULT 'unknown' NOT NULL,
    "hours_text" text DEFAULT '' NOT NULL,
    "salary_text" text DEFAULT '' NOT NULL,
    "salary_min" integer,
    "salary_max" integer,
    "sponsorship" text DEFAULT 'not_stated' NOT NULL,
    "sponsorship_evidence" text DEFAULT '' NOT NULL,
    "licensed_sponsor" boolean DEFAULT false NOT NULL,
    "sponsor_match_name" text,
    "posted_date" text,
    "closing_date" text,
    "url" text NOT NULL,
    "canonical_url" text NOT NULL,
    "source" text DEFAULT '' NOT NULL,
    "cited" boolean DEFAULT false NOT NULL,
    "link_status" text DEFAULT 'unchecked' NOT NULL,
    "first_seen" bigint NOT NULL,
    "last_seen" bigint NOT NULL,
    "status" text DEFAULT '' NOT NULL,
    "notes" text DEFAULT '' NOT NULL,
    "applied_at" bigint,
    "provider" text,
    "model" text
  )`,
  `CREATE TABLE IF NOT EXISTS "login_attempts" (
    "id" serial PRIMARY KEY NOT NULL,
    "ip" text NOT NULL,
    "attempted_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "meta" (
    "key" text PRIMARY KEY NOT NULL,
    "value" text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "refresh_runs" (
    "id" text PRIMARY KEY NOT NULL,
    "trigger" text NOT NULL,
    "started_at" bigint NOT NULL,
    "finished_at" bigint,
    "status" text NOT NULL,
    "progress" text DEFAULT '{}' NOT NULL,
    "used_default_key" boolean DEFAULT true NOT NULL,
    "error" text
  )`,
  `CREATE TABLE IF NOT EXISTS "settings" (
    "id" integer PRIMARY KEY NOT NULL,
    "sector" text NOT NULL,
    "locations" text NOT NULL,
    "notes" text NOT NULL,
    "provider" text NOT NULL,
    "model" text,
    "seen_up_to" bigint,
    "last_refresh_at" bigint,
    "updated_at" bigint NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "sponsor_register" (
    "org_name" text NOT NULL,
    "org_norm" text NOT NULL,
    "town" text DEFAULT '' NOT NULL,
    "county" text DEFAULT '' NOT NULL,
    "rating" text DEFAULT '' NOT NULL,
    "route" text DEFAULT '' NOT NULL,
    CONSTRAINT "sponsor_register_org_norm_route_pk" PRIMARY KEY("org_norm","route")
  )`,
  `CREATE TABLE IF NOT EXISTS "usage_daily" (
    "date" text NOT NULL,
    "provider" text NOT NULL,
    "runs" integer DEFAULT 0 NOT NULL,
    "calls" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "usage_daily_date_provider_pk" PRIMARY KEY("date","provider")
  )`,
  `CREATE INDEX IF NOT EXISTS "jobs_role_idx" ON "jobs" USING btree ("role_id")`,
  `CREATE INDEX IF NOT EXISTS "jobs_canonical_idx" ON "jobs" USING btree ("canonical_url")`,
  `CREATE INDEX IF NOT EXISTS "jobs_status_idx" ON "jobs" USING btree ("status")`,
  `CREATE INDEX IF NOT EXISTS "login_attempts_ip_time_idx" ON "login_attempts" USING btree ("ip","attempted_at")`,
  `CREATE INDEX IF NOT EXISTS "refresh_runs_started_idx" ON "refresh_runs" USING btree ("started_at")`,
  `CREATE INDEX IF NOT EXISTS "roles_sort_idx" ON "roles" USING btree ("archived","sort_order")`,
  `CREATE INDEX IF NOT EXISTS "sponsor_register_norm_idx" ON "sponsor_register" USING btree ("org_norm")`,
];

function isConcurrentDdlError(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const err = current as { code?: string; constraint?: string; message?: string; cause?: unknown };
    if (err.code === "42P07" || err.code === "23505") {
      return true;
    }
    if (
      typeof err.message === "string" &&
      (err.message.includes("already exists") ||
        err.message.includes("pg_type_typname_nsp_index") ||
        err.message.includes("pg_class_relname_nsp_index"))
    ) {
      return true;
    }
    current = err.cause;
  }
  return false;
}

/**
 * Applies schema DDL idempotently. Safe to call on every server start,
 * in serverless cold starts (even without filesystem access to ./drizzle),
 * and at the top of every test file.
 */
export async function runMigrations(): Promise<void> {
  const db = getDb();
  const state = getDbState();
  const target = currentDbTarget();
  for (const stmt of BOOTSTRAP_STATEMENTS) {
    try {
      await db.execute(sql.raw(stmt));
    } catch (error) {
      if (!isConcurrentDdlError(error)) {
        throw error;
      }
    }
  }
  state.migratedTarget = target;
}

/**
 * Ensures schema DDL has been applied once for the active database target.
 */
export async function ensureMigrated(): Promise<void> {
  const db = getDb(); // Ensures state.openedTarget is up to date
  const state = getDbState();
  const target = currentDbTarget();
  if (state.migratedTarget === target) return;
  if (!state.migrationPromise) {
    state.migrationPromise = (async () => {
      // Fast-path for external Postgres (Neon): if tables already exist, skip 16 DDL statements
      if (target !== ":memory:") {
        try {
          const check = await db.execute(
            sql`SELECT to_regclass('public.jobs') AS jobs_reg, to_regclass('public.login_attempts') AS login_reg, to_regclass('public.usage_daily') AS usage_reg`,
          );
          const rows = (check as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? (Array.isArray(check) ? check : []);
          const first = rows[0] as Record<string, unknown> | undefined;
          if (first && first.jobs_reg && first.login_reg && first.usage_reg) {
            state.migratedTarget = target;
            return;
          }
        } catch {
          // Fall through to full DDL bootstrap
        }
      }
      await runMigrations();
    })().finally(() => {
      state.migrationPromise = null;
    });
  }
  await state.migrationPromise;
}
