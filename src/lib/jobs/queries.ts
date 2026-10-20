import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { jobs, type JobRow } from "@/lib/db/schema";
import {
  CONTRACTS,
  LINK_STATUSES,
  SPONSORSHIPS,
  STATUSES,
  WORK_MODES,
  type Contract,
  type JobView,
  type LinkStatus,
  type Sponsorship,
  type Status,
  type WorkMode,
} from "./types";

function oneOf<T extends string>(values: readonly T[], value: string, fallback: T): T {
  return (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Maps a DB row to what the browser gets. Whitelist, not spread — nothing leaks by accident. */
export function toJobView(row: JobRow): JobView {
  return {
    id: row.id,
    roleId: row.roleId,
    title: row.title,
    org: row.org,
    locationText: row.locationText,
    locationNorm: row.locationNorm,
    workMode: oneOf<WorkMode>(WORK_MODES, row.workMode, "unknown"),
    contract: oneOf<Contract>(CONTRACTS, row.contract, "unknown"),
    hoursText: row.hoursText,
    salaryText: row.salaryText,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    sponsorship: oneOf<Sponsorship>(SPONSORSHIPS, row.sponsorship, "not_stated"),
    sponsorshipEvidence: row.sponsorshipEvidence,
    licensedSponsor: row.licensedSponsor,
    sponsorMatchName: row.sponsorMatchName,
    postedDate: row.postedDate,
    closingDate: row.closingDate,
    url: row.url,
    source: row.source,
    cited: row.cited,
    linkStatus: oneOf<LinkStatus>(LINK_STATUSES, row.linkStatus, "unchecked"),
    firstSeen: row.firstSeen,
    lastSeen: row.lastSeen,
    status: oneOf<Status>(STATUSES, row.status, ""),
    notes: row.notes,
    appliedAt: row.appliedAt,
  };
}

export function listJobs(): JobRow[] {
  return getDb().select().from(jobs).all();
}

export function getJob(id: string): JobRow | undefined {
  return getDb().select().from(jobs).where(eq(jobs.id, id)).get();
}

export class JobNotFoundError extends Error {
  constructor() {
    super("That role is no longer on the board. Refresh to see the latest list.");
    this.name = "JobNotFoundError";
  }
}

/**
 * The only fields she can change on a listing (brief: PATCH /api/jobs/:id is
 * status and notes only). `applied_at` is set automatically the first time the
 * status becomes Applied and is never cleared by later changes.
 */
export function updateJobTracking(
  id: string,
  patch: { status?: Status; notes?: string },
  now: number = Date.now(),
): JobRow {
  const db = getDb();
  const existing = getJob(id);
  if (!existing) throw new JobNotFoundError();

  const set: Partial<JobRow> = {};
  if (patch.status !== undefined) {
    set.status = patch.status;
    if (patch.status === "applied" && existing.appliedAt === null) set.appliedAt = now;
  }
  if (patch.notes !== undefined) set.notes = patch.notes;

  if (Object.keys(set).length > 0) db.update(jobs).set(set).where(eq(jobs.id, id)).run();
  return getJob(id)!;
}
