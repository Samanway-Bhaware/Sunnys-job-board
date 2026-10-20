import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { refreshRuns, type RefreshRunRow } from "@/lib/db/schema";
import { applyRetention, mergeListings } from "@/lib/jobs/merge";
import type { NormalisedListing, RoleView } from "@/lib/jobs/types";
import { log } from "@/lib/log";
import { listRoles, toRoleView } from "@/lib/roles";
import { scrub } from "@/lib/scrub";
import { scrapeAll, configuredScrapers } from "@/lib/scrapers";
import { checkLinks, type FetchLike } from "@/lib/search/linkcheck";
import { getScope, markRefreshCompleted } from "@/lib/settings";
import { matchSponsor, registerStatus } from "@/lib/sponsor/register";
import {
  acquireLock,
  cooldownRemaining,
  releaseLock,
  usageFor,
  type UsageView,
} from "./policy";

export type Trigger = "visit" | "manual" | "role_added";

export interface PipelineStats {
  parsed: number;
  droppedInvalid: number;
  droppedBadUrl: number;
  droppedGone: number;
  verified: number;
  unverified: number;
  cited: number;
  licensedSponsors: number;
  truncated: boolean;
  added: number;
  updated: number;
}

export interface RoleProgress {
  state: "searching" | "done" | "error";
  count?: number;
  error?: string;
  stats?: PipelineStats;
  usage?: { inputTokens?: number; outputTokens?: number; searches?: number };
  ms?: number;
}

export type Progress = Record<string, RoleProgress>;

export interface RunView {
  id: string;
  trigger: Trigger;
  startedAt: number;
  finishedAt: number | null;
  status: "running" | "done" | "failed";
  progress: Progress;
  usedDefaultKey: boolean;
  error: string | null;
}

export type StartResult =
  | { started: true; run: RunView }
  | { started: false; reason: "running"; run: RunView }
  | { started: false; reason: "cooldown"; retryInMs: number }
  | { started: false; reason: "cap"; usage: UsageView }
  | { started: false; reason: "no_roles" }
  | { started: false; reason: "unavailable"; message: string };

export function toRunView(row: RefreshRunRow): RunView {
  let progress: Progress = {};
  try {
    progress = JSON.parse(row.progress) as Progress;
  } catch {
    progress = {};
  }
  return {
    id: row.id,
    trigger: row.trigger as Trigger,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    status: row.status as RunView["status"],
    progress,
    usedDefaultKey: row.usedDefaultKey,
    error: row.error,
  };
}

export function getRun(id: string): RunView | null {
  const row = getDb().select().from(refreshRuns).where(eq(refreshRuns.id, id)).get();
  return row ? toRunView(row) : null;
}

export function latestRun(): RunView | null {
  const row = getDb().select().from(refreshRuns).orderBy(desc(refreshRuns.startedAt)).limit(1).get();
  return row ? toRunView(row) : null;
}

function writeProgress(runId: string, progress: Progress): void {
  getDb()
    .update(refreshRuns)
    .set({ progress: JSON.stringify(progress) })
    .where(eq(refreshRuns.id, runId))
    .run();
}

export async function currentUsage(): Promise<UsageView | null> {
  return usageFor("scrapers", false);
}

const inflight = new Map<string, Promise<void>>();

export async function waitForRun(id: string): Promise<void> {
  await inflight.get(id);
}

function matchListingToRole(listing: NormalisedListing, roles: RoleView[]): RoleView {
  if (roles.length <= 1) return roles[0]!;

  const titleLower = listing.title.toLowerCase();
  let bestRole = roles[0]!;
  let bestScore = -1;

  for (const role of roles) {
    let score = 0;
    const nameWords = role.name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    for (const w of nameWords) {
      if (titleLower.includes(w)) score += 3;
    }
    const keywordWords = (role.keywords ?? "").toLowerCase().split(/[,;\s]+/).filter((w) => w.length > 2);
    for (const w of keywordWords) {
      if (titleLower.includes(w)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRole = role;
    }
  }

  return bestRole;
}

export async function startRefresh(options: { trigger: Trigger; roleIds?: string[] }): Promise<StartResult> {
  const now = Date.now();

  if (options.trigger === "visit") {
    const remaining = cooldownRemaining(now);
    if (remaining > 0) return { started: false, reason: "cooldown", retryInMs: remaining };
  }

  const scrapers = configuredScrapers();
  if (scrapers.length === 0) {
    return { started: false, reason: "unavailable", message: "No job board scrapers are available." };
  }

  const enabled = listRoles()
    .filter((r) => r.enabled)
    .filter((r) => !options.roleIds || options.roleIds.includes(r.id))
    .map(toRoleView);
  if (enabled.length === 0) return { started: false, reason: "no_roles" };

  const id = randomUUID();
  const lock = acquireLock(id, now);
  if (!lock.acquired) {
    const holder = getRun(lock.heldBy);
    if (holder) return { started: false, reason: "running", run: holder };
  }

  const progress: Progress = Object.fromEntries(enabled.map((r) => [r.id, { state: "searching" }]));
  getDb()
    .insert(refreshRuns)
    .values({
      id,
      trigger: options.trigger,
      startedAt: now,
      finishedAt: null,
      status: "running",
      progress: JSON.stringify(progress),
      usedDefaultKey: true,
      error: null,
    })
    .run();

  const task = processScraperRun(id, enabled, progress).catch((error: unknown) => {
    finishRun(id, "failed", scrub(error instanceof Error ? error.message : "Something went wrong."));
  });
  inflight.set(id, task.finally(() => inflight.delete(id)));

  return { started: true, run: getRun(id)! };
}

export async function runRefreshAndWait(options: { trigger: Trigger; roleIds?: string[] }): Promise<StartResult> {
  const result = await startRefresh(options);
  if (result.started) {
    await waitForRun(result.run.id);
    return { started: true, run: getRun(result.run.id)! };
  }
  return result;
}

async function processScraperRun(runId: string, roles: RoleView[], progress: Progress): Promise<void> {
  const started = Date.now();
  try {
    const scope = getScope();

    // Collect all search keywords from roles
    const allKeywords = roles.flatMap((r) => [
      r.name,
      ...r.keywords.split(/[,;]+/).map((k) => k.trim()).filter(Boolean),
    ]);
    const uniqueKeywords = [...new Set(allKeywords)];

    log.info("scrapers", `Starting scrape with keywords: ${uniqueKeywords.join(", ")}`);

    // Run all scrapers concurrently
    const { results, listings } = await scrapeAll({
      keywords: uniqueKeywords,
      locations: scope.locations,
      sector: scope.sector,
    });

    log.info("scrapers", `Scraped ${listings.length} candidate listings across ${results.length} boards`);

    // Step 1: Link checking
    let kept = listings;
    let droppedGone = 0;
    let verified = 0;
    let unverified = 0;

    const shouldCheckLinks = process.env.USE_MOCK_PROVIDER !== "1" && process.env.NODE_ENV !== "test";
    if (listings.length > 0 && shouldCheckLinks) {
      const linkResults = await checkLinks(listings.map((l) => l.canonicalUrl), {
        concurrency: 30,
        timeoutMs: 3500,
      });
      kept = [];
      for (const listing of listings) {
        const status = linkResults.get(listing.canonicalUrl) ?? "unverified";
        if (status === "gone") {
          droppedGone += 1;
          continue;
        }
        if (status === "verified") verified += 1;
        else unverified += 1;
        kept.push({ ...listing, linkStatus: status });
      }
    }

    // Step 2: Sponsor register matching
    const hasSponsors = registerStatus().available;
    if (hasSponsors) {
      kept = kept.map((listing) => {
        const match = matchSponsor(listing.org, listing.locationNorm);
        return match ? { ...listing, licensedSponsor: true, sponsorMatchName: match.name } : listing;
      });
    }

    // Step 3: Distribute listings to roles and merge
    const listingsByRole = new Map<string, NormalisedListing[]>();
    for (const role of roles) {
      listingsByRole.set(role.id, []);
    }

    for (const listing of kept) {
      const targetRole = matchListingToRole(listing, roles);
      listingsByRole.get(targetRole.id)?.push(listing);
    }

    const mergeNow = Date.now();
    let totalAdded = 0;
    let totalUpdated = 0;

    for (const role of roles) {
      const roleListings = listingsByRole.get(role.id) ?? [];
      const mergeRes = mergeListings(roleListings, {
        roleId: role.id,
        now: mergeNow,
        provider: "scrapers",
        model: null,
      });

      totalAdded += mergeRes.added;
      totalUpdated += mergeRes.updated;

      const roleStats: PipelineStats = {
        parsed: roleListings.length,
        droppedInvalid: 0,
        droppedBadUrl: 0,
        droppedGone: 0,
        verified: roleListings.filter((l) => l.linkStatus === "verified").length,
        unverified: roleListings.filter((l) => l.linkStatus === "unverified").length,
        cited: 0,
        licensedSponsors: roleListings.filter((l) => l.licensedSponsor).length,
        truncated: false,
        added: mergeRes.added,
        updated: mergeRes.updated,
      };

      progress[role.id] = {
        state: "done",
        count: mergeRes.added + mergeRes.updated,
        stats: roleStats,
        ms: Date.now() - started,
      };
    }

    writeProgress(runId, progress);

    const finishedAt = Date.now();
    applyRetention(finishedAt);
    markRefreshCompleted(finishedAt);
    finishRun(runId, "done", null, finishedAt);

    log.info(
      "scrapers",
      `Refresh finished in ${finishedAt - started}ms: ${totalAdded} added, ${totalUpdated} updated, ${droppedGone} gone`,
    );
  } catch (error) {
    log.error("scrapers", "Refresh run failed", error);
    for (const role of roles) {
      if (progress[role.id]?.state === "searching") {
        progress[role.id] = { state: "error", error: describe(error) };
      }
    }
    writeProgress(runId, progress);
    finishRun(runId, "failed", describe(error));
  } finally {
    releaseLock(runId);
  }
}

function finishRun(runId: string, status: "done" | "failed", error: string | null, finishedAt: number = Date.now()): void {
  getDb()
    .update(refreshRuns)
    .set({ status, error, finishedAt })
    .where(eq(refreshRuns.id, runId))
    .run();
}

export function describe(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "The scrape took too long and was stopped.";
  if (error instanceof Error) return scrub(error.message);
  return "Something went wrong.";
}
