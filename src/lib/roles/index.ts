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

export async function listRoles(options: { includeArchived?: boolean } = {}): Promise<RoleRow[]> {
  const db = getDb();
  const rows = await db.select().from(roles).orderBy(asc(roles.sortOrder), asc(roles.createdAt));
  return options.includeArchived ? rows : rows.filter((r) => !r.archived);
}

export async function getRole(id: string): Promise<RoleRow | undefined> {
  const rows = await getDb().select().from(roles).where(eq(roles.id, id));
  return rows[0];
}

export async function activeRoleCount(): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(roles)
    .where(eq(roles.archived, false));
  return rows[0]?.n ?? 0;
}

export async function createRole(
  input: { name: string; keywords?: string },
  now: number = Date.now(),
): Promise<RoleRow> {
  const db = getDb();
  const active = await db.select().from(roles).where(eq(roles.archived, false));
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
  await db.insert(roles).values(row);
  return row;
}

export async function updateRole(
  id: string,
  patch: { name?: string; keywords?: string; enabled?: boolean },
): Promise<RoleRow> {
  const db = getDb();
  const rows = await db
    .select()
    .from(roles)
    .where(and(eq(roles.id, id), eq(roles.archived, false)));
  const existing = rows[0];
  if (!existing) throw new RoleNotFoundError();

  const set: Partial<RoleRow> = {};
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.keywords !== undefined) set.keywords = patch.keywords.trim();
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (Object.keys(set).length > 0) {
    await db.update(roles).set(set).where(eq(roles.id, id));
  }

  return (await getRole(id))!;
}

/** Sets sort order from the given id list; ids not listed keep their relative order after. */
export async function reorderRoles(orderedIds: string[]): Promise<RoleRow[]> {
  const db = getDb();
  const active = await db.select().from(roles).where(eq(roles.archived, false));
  const known = new Set(active.map((r) => r.id));
  const ordered = orderedIds.filter((id) => known.has(id));
  const rest = active
    .filter((r) => !ordered.includes(r.id))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => r.id);

  const all = [...ordered, ...rest];
  for (let index = 0; index < all.length; index += 1) {
    const id = all[index]!;
    await db.update(roles).set({ sortOrder: index }).where(eq(roles.id, id));
  }
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
export async function deleteRole(id: string): Promise<DeleteOutcome> {
  const db = getDb();
  const rows = await db
    .select()
    .from(roles)
    .where(and(eq(roles.id, id), eq(roles.archived, false)));
  const existing = rows[0];
  if (!existing) throw new RoleNotFoundError();

  const untracked = await db
    .delete(jobs)
    .where(and(eq(jobs.roleId, id), eq(jobs.status, "")))
    .returning();

  const trackedRows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.roleId, id), ne(jobs.status, "")));
  const trackedKept = trackedRows[0]?.n ?? 0;

  if (trackedKept > 0) {
    await db.update(roles).set({ archived: true, enabled: false }).where(eq(roles.id, id));
    return { kind: "archived", trackedKept, untrackedRemoved: untracked.length };
  }

  await db.delete(roles).where(eq(roles.id, id));
  return { kind: "deleted", untrackedRemoved: untracked.length };
}
