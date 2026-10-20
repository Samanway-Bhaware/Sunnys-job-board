import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Data model from the brief (section 5), with the additions logged in RECONCILE:
 *  - `sponsor_register` gains `county` and `rating` (RECONCILE #7)
 *  - `login_attempts` for the Phase 1 rate limiter
 *  - `roles.archived` is how a deleted role keeps its tracked jobs in the Archived tab
 * Timestamps are integer milliseconds since the epoch.
 */

export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ip: text("ip").notNull(),
    attemptedAt: integer("attempted_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("login_attempts_ip_time_idx").on(table.ip, table.attemptedAt)],
);

/** Singleton — exactly one row, id = 1. */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  sector: text("sector").notNull(),
  /** JSON array of strings. */
  locations: text("locations").notNull(),
  notes: text("notes").notNull(),
  provider: text("provider").notNull(),
  model: text("model"),
  /** When the previous visit's refresh completed. Drives the "New" badge. */
  seenUpTo: integer("seen_up_to"),
  /** When the last successful refresh finished. Drives the cooldown and "Updated N min ago". */
  lastRefreshAt: integer("last_refresh_at"),
  updatedAt: integer("updated_at").notNull(),
});

export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    keywords: text("keywords").notNull().default(""),
    color: text("color").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull(),
    /** A deleted role that still had tracked jobs. Hidden everywhere except the Archived tab. */
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("roles_sort_idx").on(table.archived, table.sortOrder)],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    org: text("org").notNull(),
    locationText: text("location_text").notNull().default(""),
    locationNorm: text("location_norm").notNull().default(""),
    workMode: text("work_mode").notNull().default("unknown"),
    contract: text("contract").notNull().default("unknown"),
    hoursText: text("hours_text").notNull().default(""),
    salaryText: text("salary_text").notNull().default(""),
    salaryMin: integer("salary_min"),
    salaryMax: integer("salary_max"),
    sponsorship: text("sponsorship").notNull().default("not_stated"),
    sponsorshipEvidence: text("sponsorship_evidence").notNull().default(""),
    licensedSponsor: integer("licensed_sponsor", { mode: "boolean" }).notNull().default(false),
    sponsorMatchName: text("sponsor_match_name"),
    /** YYYY-MM-DD or null. */
    postedDate: text("posted_date"),
    closingDate: text("closing_date"),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    source: text("source").notNull().default(""),
    cited: integer("cited", { mode: "boolean" }).notNull().default(false),
    linkStatus: text("link_status").notNull().default("unchecked"),
    firstSeen: integer("first_seen").notNull(),
    lastSeen: integer("last_seen").notNull(),
    /** '' = not started. See STATUSES in @/lib/jobs/types. */
    status: text("status").notNull().default(""),
    notes: text("notes").notNull().default(""),
    appliedAt: integer("applied_at"),
    provider: text("provider"),
    model: text("model"),
  },
  (table) => [
    index("jobs_role_idx").on(table.roleId),
    index("jobs_canonical_idx").on(table.canonicalUrl),
    index("jobs_status_idx").on(table.status),
  ],
);

export const apiKeys = sqliteTable("api_keys", {
  provider: text("provider").primaryKey(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  tag: text("tag").notNull(),
  last4: text("last4").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const refreshRuns = sqliteTable(
  "refresh_runs",
  {
    id: text("id").primaryKey(),
    trigger: text("trigger").notNull(),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    /** running | done | failed */
    status: text("status").notNull(),
    /** JSON: { [roleId]: { state: "searching"|"done"|"error", count?, error? } } */
    progress: text("progress").notNull().default("{}"),
    usedDefaultKey: integer("used_default_key", { mode: "boolean" }).notNull().default(true),
    error: text("error"),
  },
  (table) => [index("refresh_runs_started_idx").on(table.startedAt)],
);

export const usageDaily = sqliteTable(
  "usage_daily",
  {
    /** YYYY-MM-DD */
    date: text("date").notNull(),
    provider: text("provider").notNull(),
    runs: integer("runs").notNull().default(0),
    calls: integer("calls").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.date, table.provider] })],
);

export const sponsorRegister = sqliteTable(
  "sponsor_register",
  {
    orgName: text("org_name").notNull(),
    orgNorm: text("org_norm").notNull(),
    town: text("town").notNull().default(""),
    county: text("county").notNull().default(""),
    rating: text("rating").notNull().default(""),
    route: text("route").notNull().default(""),
  },
  (table) => [
    // Organisations repeat once per route in the source CSV (RECONCILE #7).
    primaryKey({ columns: [table.orgNorm, table.route] }),
    index("sponsor_register_norm_idx").on(table.orgNorm),
  ],
);

export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type SettingsRow = typeof settings.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type RefreshRunRow = typeof refreshRuns.$inferSelect;
