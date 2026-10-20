import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
} from "drizzle-orm/pg-core";

/**
 * Data model from the brief (section 5), with the additions logged in RECONCILE:
 *  - `sponsor_register` gains `county` and `rating` (RECONCILE #7)
 *  - `login_attempts` for the Phase 1 rate limiter
 *  - `roles.archived` is how a deleted role keeps its tracked jobs in the Archived tab
 * Timestamps are integer milliseconds since the epoch, stored as bigint with mode: "number".
 */

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: serial("id").primaryKey(),
    ip: text("ip").notNull(),
    attemptedAt: bigint("attempted_at", { mode: "number" })
      .notNull()
      .default(sql`(extract(epoch from now()) * 1000)::bigint`),
  },
  (table) => [index("login_attempts_ip_time_idx").on(table.ip, table.attemptedAt)],
);

/** Singleton — exactly one row, id = 1. */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey(),
  sector: text("sector").notNull(),
  /** JSON array of strings. */
  locations: text("locations").notNull(),
  notes: text("notes").notNull(),
  provider: text("provider").notNull(),
  model: text("model"),
  /** When the previous visit's refresh completed. Drives the "New" badge. */
  seenUpTo: bigint("seen_up_to", { mode: "number" }),
  /** When the last successful refresh finished. Drives the cooldown and "Updated N min ago". */
  lastRefreshAt: bigint("last_refresh_at", { mode: "number" }),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const roles = pgTable(
  "roles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    keywords: text("keywords").notNull().default(""),
    color: text("color").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull(),
    /** A deleted role that still had tracked jobs. Hidden everywhere except the Archived tab. */
    archived: boolean("archived").notNull().default(false),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [index("roles_sort_idx").on(table.archived, table.sortOrder)],
);

export const jobs = pgTable(
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
    sponsorshipEvidence: text("sponsorship_evidence").notNull().default("") ,
    licensedSponsor: boolean("licensed_sponsor").notNull().default(false),
    sponsorMatchName: text("sponsor_match_name"),
    /** YYYY-MM-DD or null. */
    postedDate: text("posted_date"),
    closingDate: text("closing_date"),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    source: text("source").notNull().default(""),
    cited: boolean("cited").notNull().default(false),
    linkStatus: text("link_status").notNull().default("unchecked"),
    firstSeen: bigint("first_seen", { mode: "number" }).notNull(),
    lastSeen: bigint("last_seen", { mode: "number" }).notNull(),
    /** '' = not started. See STATUSES in @/lib/jobs/types. */
    status: text("status").notNull().default(""),
    notes: text("notes").notNull().default(""),
    appliedAt: bigint("applied_at", { mode: "number" }),
    provider: text("provider"),
    model: text("model"),
  },
  (table) => [
    index("jobs_role_idx").on(table.roleId),
    index("jobs_canonical_idx").on(table.canonicalUrl),
    index("jobs_status_idx").on(table.status),
  ],
);

export const apiKeys = pgTable("api_keys", {
  provider: text("provider").primaryKey(),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  tag: text("tag").notNull(),
  last4: text("last4").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const refreshRuns = pgTable(
  "refresh_runs",
  {
    id: text("id").primaryKey(),
    trigger: text("trigger").notNull(),
    startedAt: bigint("started_at", { mode: "number" }).notNull(),
    finishedAt: bigint("finished_at", { mode: "number" }),
    /** running | done | failed */
    status: text("status").notNull(),
    /** JSON: { [roleId]: { state: "searching"|"done"|"error", count?, error? } } */
    progress: text("progress").notNull().default("{}"),
    usedDefaultKey: boolean("used_default_key").notNull().default(true),
    error: text("error"),
  },
  (table) => [index("refresh_runs_started_idx").on(table.startedAt)],
);

export const usageDaily = pgTable(
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

export const sponsorRegister = pgTable(
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

export const meta = pgTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type SettingsRow = typeof settings.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type RefreshRunRow = typeof refreshRuns.$inferSelect;
