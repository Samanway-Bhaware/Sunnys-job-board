import { randomUUID } from "node:crypto";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { jobs, roles, type RoleRow } from "@/lib/db/schema";
import type { RoleView } from "@/lib/jobs/types";
import { nextColor } from "./palette";

/** Brief section 2.2: at most 10 roles, as a cost guard. Archived roles don't count. */
export const MAX_ROLES = 10;

export class RoleLimitError extends Error {
  constructor() {
    super(`You can have up to ${MAX_ROLES} roles. Remove one before adding another.`);
    this.name = "RoleLimitError";
  }
}

export class RoleNotFoundError extends Error {
  constructor() {
    super("That role no longer exists. Reload the page and try again.");
    this.name = "RoleNotFoundError";
  }
}

export function toRoleView(row: RoleRow): RoleView {
  return {
    id: row.id,
    name: row.name,
    keywords: row.keywords,
    color: row.color,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    archived: row.archived,
  };
}

export function listRoles(options: { includeArchived?: boolean } = {}): RoleRow[] {
  const db = getDb();
  const query = db.select().from(roles).orderBy(asc(roles.sortOrder), asc(roles.createdAt));
  const rows = query.all();
  return options.includeArchived ? rows : rows.filter((r) => !r.archived);
}

export function getRole(id: string): RoleRow | undefined {
  return getDb().select().from(roles).where(eq(roles.id, id)).get();
}

export function activeRoleCount(): number {
  const row = getDb()
    .select({ n: sql<number>`count(*)` })
    .from(roles)
    .where(eq(roles.archived, false))
    .get();
  return row?.n ?? 0;
}

export function createRole(
  input: { name: string; keywords?: string },
  now: number = Date.now(),
): RoleRow {
  const db = getDb();
  return db.transaction((tx) => {
    const active = tx.select().from(roles).where(eq(roles.archived, false)).all();
    if (active.length >= MAX_ROLES) throw new RoleLimitError();

    const maxOrder = active.reduce((max, r) => Math.max(max, r.sortOrder), -1);
    const row: RoleRow = {
      id: randomUUID(),
      name: input.name.trim(),
      keywords: (input.keywords ?? "").trim(),
      color: nextColor(active.map((r) => r.color)),
      enabled: true,
      sortOrder: maxOrder + 1,
      archived: false,
      createdAt: now,
    };
    tx.insert(roles).values(row).run();
    return row;
  });
}

export function updateRole(
  id: string,
  patch: { name?: string; keywords?: string; enabled?: boolean },
): RoleRow {
  const db = getDb();
  const existing = db
    .select()
    .from(roles)
    .where(and(eq(roles.id, id), eq(roles.archived, false)))
    .get();
  if (!existing) throw new RoleNotFoundError();

  const set: Partial<RoleRow> = {};
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.keywords !== undefined) set.keywords = patch.keywords.trim();
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (Object.keys(set).length > 0) db.update(roles).set(set).where(eq(roles.id, id)).run();

  return getRole(id)!;
}

/** Sets sort order from the given id list; ids not listed keep their relative order after. */
export function reorderRoles(orderedIds: string[]): RoleRow[] {
  const db = getDb();
  db.transaction((tx) => {
    const active = tx.select().from(roles).where(eq(roles.archived, false)).all();
    const known = new Set(active.map((r) => r.id));
    const ordered = orderedIds.filter((id) => known.has(id));
    const rest = active
      .filter((r) => !ordered.includes(r.id))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((r) => r.id);

    [...ordered, ...rest].forEach((id, index) => {
      tx.update(roles).set({ sortOrder: index }).where(eq(roles.id, id)).run();
    });
  });
  return listRoles();
}

export type DeleteOutcome =
  | { kind: "deleted"; untrackedRemoved: number }
  | { kind: "archived"; trackedKept: number; untrackedRemoved: number };

/**
 * Brief section 2.2: when a role is deleted, its tracked jobs (any status set)
 * move to an Archived tab instead of disappearing, and its untracked jobs are
 * deleted. If nothing was tracked, the role row itself goes too.
 */
export function deleteRole(id: string): DeleteOutcome {
  const db = getDb();
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.archived, false)))
      .get();
    if (!existing) throw new RoleNotFoundError();

    const untracked = tx
      .delete(jobs)
      .where(and(eq(jobs.roleId, id), eq(jobs.status, "")))
      .run();

    const trackedKept =
      tx
        .select({ n: sql<number>`count(*)` })
        .from(jobs)
        .where(and(eq(jobs.roleId, id), ne(jobs.status, "")))
        .get()?.n ?? 0;

    if (trackedKept > 0) {
      tx.update(roles).set({ archived: true, enabled: false }).where(eq(roles.id, id)).run();
      return { kind: "archived", trackedKept, untrackedRemoved: untracked.changes };
    }

    tx.delete(roles).where(eq(roles.id, id)).run();
    return { kind: "deleted", untrackedRemoved: untracked.changes };
  });
}
