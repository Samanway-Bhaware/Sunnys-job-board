import { randomUUID } from "node:crypto";
import { and, eq, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { jobs, type JobRow } from "@/lib/db/schema";
import { DAY_MS, todayString } from "@/lib/dates";
import type { NormalisedListing } from "./types";

/** Brief section 2.5 retention: untracked listings drop off after 21 days unseen. */
export const STALE_DAYS = 21;

/** The org+title fallback key for dedupe (brief section 2.5 step 6). */
export function orgTitleKey(org: string, title: string): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${norm(org)}|${norm(title)}`;
}

export interface MergeContext {
  roleId: string;
  now: number;
  provider: string | null;
  model: string | null;
}

export interface MergeResult {
  added: number;
  updated: number;
}

/**
 * Upserts listings for one role (brief section 2.5 step 8).
 *
 * Dedupe is global, not per role: a "Marketing and Communications Officer" found
 * by two role searches is one listing, owned by whichever role saw it first, so
 * the "All roles" tab never shows the same job twice.
 *
 * Existing listings get `last_seen = now` and their empty fields filled. Her
 * status, notes and applied date are never touched here.
 */
export async function mergeListings(listings: NormalisedListing[], ctx: MergeContext): Promise<MergeResult> {
  const db = getDb();
  let added = 0;
  let updated = 0;

  for (const listing of listings) {
    const existing = await findExisting(db, listing);

    if (existing) {
      await db.update(jobs)
        .set(fillBlanks(existing, listing, ctx))
        .where(eq(jobs.id, existing.id));
      updated += 1;
      continue;
    }

    await db.insert(jobs)
      .values({
        id: randomUUID(),
        roleId: ctx.roleId,
        title: listing.title,
        org: listing.org,
        locationText: listing.locationText,
        locationNorm: listing.locationNorm,
        workMode: listing.workMode,
        contract: listing.contract,
        hoursText: listing.hoursText,
        salaryText: listing.salaryText,
        salaryMin: listing.salaryMin,
        salaryMax: listing.salaryMax,
        sponsorship: listing.sponsorship,
        sponsorshipEvidence: listing.sponsorshipEvidence,
        licensedSponsor: listing.licensedSponsor ?? false,
        sponsorMatchName: listing.sponsorMatchName ?? null,
        postedDate: listing.postedDate,
        closingDate: listing.closingDate,
        url: listing.url,
        canonicalUrl: listing.canonicalUrl,
        source: listing.source,
        cited: listing.cited,
        linkStatus: listing.linkStatus,
        firstSeen: ctx.now,
        lastSeen: ctx.now,
        status: "",
        notes: "",
        appliedAt: null,
        provider: ctx.provider,
        model: ctx.model,
      });
    added += 1;
  }

  return { added, updated };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findExisting(tx: any, listing: NormalisedListing): Promise<JobRow | undefined> {
  const byUrlRows = await tx.select().from(jobs).where(eq(jobs.canonicalUrl, listing.canonicalUrl));
  if (byUrlRows[0]) return byUrlRows[0];

  // Fallback: same organisation and title, compared loosely.
  const key = orgTitleKey(listing.org, listing.title);
  const candidates = await tx
    .select()
    .from(jobs)
    .where(sql`lower(${jobs.org}) = lower(${listing.org})`);
  return candidates.find((row: JobRow) => orgTitleKey(row.org, row.title) === key);
}

/** Only fills fields the stored row lacks. Never overwrites status, notes or appliedAt. */
function fillBlanks(existing: JobRow, fresh: NormalisedListing, ctx: MergeContext): Partial<JobRow> {
  const set: Partial<JobRow> = { lastSeen: ctx.now };

  const text = (key: keyof JobRow & keyof NormalisedListing) => {
    const current = existing[key];
    const incoming = fresh[key];
    if ((current === "" || current === null) && typeof incoming === "string" && incoming !== "") {
      (set as Record<string, unknown>)[key] = incoming;
    }
  };
  text("locationText");
  text("locationNorm");
  text("hoursText");
  text("salaryText");
  text("sponsorshipEvidence");
  text("source");

  if (existing.workMode === "unknown" && fresh.workMode !== "unknown") set.workMode = fresh.workMode;
  if (existing.contract === "unknown" && fresh.contract !== "unknown") set.contract = fresh.contract;
  if (existing.sponsorship === "not_stated" && fresh.sponsorship !== "not_stated") {
    set.sponsorship = fresh.sponsorship;
  }
  if (existing.salaryMin === null && fresh.salaryMin !== null) set.salaryMin = fresh.salaryMin;
  if (existing.salaryMax === null && fresh.salaryMax !== null) set.salaryMax = fresh.salaryMax;
  if (existing.postedDate === null && fresh.postedDate !== null) set.postedDate = fresh.postedDate;
  if (existing.closingDate === null && fresh.closingDate !== null) set.closingDate = fresh.closingDate;
  if (!existing.cited && fresh.cited) set.cited = true;
  if (!existing.licensedSponsor && fresh.licensedSponsor) {
    set.licensedSponsor = true;
    set.sponsorMatchName = fresh.sponsorMatchName ?? null;
  }
  if (existing.linkStatus === "unchecked" && fresh.linkStatus !== "unchecked") {
    set.linkStatus = fresh.linkStatus;
  }
  if (existing.provider === null && ctx.provider) set.provider = ctx.provider;
  if (existing.model === null && ctx.model) set.model = ctx.model;

  return set;
}

/**
 * Brief section 2.5 retention: untracked listings are removed once their closing
 * date has passed or they haven't been seen for 21 days. Tracked listings (any
 * status set) are always kept.
 */
export async function applyRetention(now: number = Date.now()): Promise<number> {
  const today = todayString(now);
  const cutoff = now - STALE_DAYS * DAY_MS;

  const result = await getDb()
    .delete(jobs)
    .where(
      and(
        eq(jobs.status, ""),
        or(
          and(sql`${jobs.closingDate} is not null`, lt(jobs.closingDate, today)),
          lt(jobs.lastSeen, cutoff),
        ),
      ),
    )
    .returning();

  return result.length;
}
