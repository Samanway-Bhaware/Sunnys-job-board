import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as refreshRoute } from "@/app/api/refresh/route";
import { GET as runRoute } from "@/app/api/refresh/[id]/route";
import { seedDatabase } from "@/lib/db/seed";
import { listJobs } from "@/lib/jobs/queries";
import type { NormalisedListing } from "@/lib/jobs/types";
import { runRefreshAndWait, waitForRun, type RunView, type Trigger } from "@/lib/refresh/run";
import { listRoles } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import * as scrapersModule from "@/lib/scrapers";
import { authed, params, resetTables } from "../helpers";

const MOCK_LISTINGS: NormalisedListing[] = [
  {
    org: "Creative Fund Scotland",
    title: "Communications Officer",
    locationText: "Remote (UK)",
    locationNorm: "Remote",
    workMode: "remote",
    contract: "part_time",
    hoursText: "part time",
    salaryText: "£24,500",
    salaryMin: 24500,
    salaryMax: null,
    sponsorship: "not_stated",
    sponsorshipEvidence: "",
    postedDate: "2026-09-01",
    closingDate: "2026-10-30",
    url: "https://example.com/job1",
    canonicalUrl: "https://example.com/job1",
    source: "freehire",
    cited: false,
    linkStatus: "verified",
  },
  {
    org: "Royal Mile Playhouse",
    title: "Marketing & Press Officer",
    locationText: "Edinburgh",
    locationNorm: "Edinburgh",
    workMode: "unknown",
    contract: "full_time",
    hoursText: "full time",
    salaryText: "£32,000 - £36,000",
    salaryMin: 32000,
    salaryMax: 36000,
    sponsorship: "not_stated",
    sponsorshipEvidence: "",
    postedDate: "2026-09-05",
    closingDate: "2026-10-30",
    url: "https://example.com/job2",
    canonicalUrl: "https://example.com/job2",
    source: "freehire",
    cited: false,
    linkStatus: "verified",
  },
  {
    org: "Scottish Books Network",
    title: "Digital Content Assistant",
    locationText: "Edinburgh",
    locationNorm: "Edinburgh",
    workMode: "unknown",
    contract: "part_time",
    hoursText: "part time",
    salaryText: "£14/hr",
    salaryMin: null,
    salaryMax: null,
    sponsorship: "not_stated",
    sponsorshipEvidence: "",
    postedDate: "2026-09-10",
    closingDate: "2026-10-30",
    url: "https://example.com/job3",
    canonicalUrl: "https://example.com/job3",
    source: "freehire",
    cited: false,
    linkStatus: "verified",
  },
];

vi.spyOn(scrapersModule, "scrapeAll").mockImplementation(async () => ({
  results: [
    {
      scraperId: "freehire",
      scraperName: "FreeHire Public API",
      jobs: [],
      durationMs: 50,
      error: null,
    },
  ],
  listings: MOCK_LISTINGS,
  totalDurationMs: 50,
}));

beforeEach(async () => {
  await resetTables();
  await seedDatabase();
});

async function runOk(trigger: Trigger): Promise<RunView> {
  const result = await runRefreshAndWait({ trigger });
  if (!result.started) throw new Error(`refresh did not start: ${result.reason}`);
  return result.run;
}

describe("refresh with scrapers", () => {
  it("runs a scrape and merges normalised listings across roles", async () => {
    const run = await runOk("manual");

    expect(run.status).toBe("done");
    const roles = await listRoles();
    expect(Object.keys(run.progress).sort()).toEqual(roles.map((r) => r.id).sort());
    for (const p of Object.values(run.progress)) {
      expect(p.state).toBe("done");
    }

    const jobs = await listJobs();
    expect(jobs.length).toBeGreaterThanOrEqual(3);

    expect((await getSettings()).seenUpTo).toBe(run.finishedAt);
    expect((await getSettings()).lastRefreshAt).toBe(run.finishedAt);
  });

  it("normalises listing fields the way the filters expect", async () => {
    await runOk("manual");
    const jobs = await listJobs();
    const byOrg = (org: string) => jobs.find((j) => j.org === org)!;

    expect(byOrg("Creative Fund Scotland")).toMatchObject({
      workMode: "remote",
      contract: "part_time",
      locationNorm: "Remote",
      salaryMin: 24500,
    });
    expect(byOrg("Royal Mile Playhouse")).toMatchObject({
      salaryMin: 32000,
      salaryMax: 36000,
      locationNorm: "Edinburgh",
    });
    expect(byOrg("Scottish Books Network")).toMatchObject({
      salaryMin: null,
      salaryMax: null,
    });
  });

  it("skips disabled roles", async () => {
    const [first] = await listRoles();
    const { updateRole } = await import("@/lib/roles");
    await updateRole(first!.id, { enabled: false });

    const run = await runOk("visit");
    expect(run.progress[first!.id]).toBeUndefined();
    expect(Object.keys(run.progress)).toHaveLength(2);
  });

  it("is idempotent across runs — a second run adds nothing", async () => {
    await runOk("manual");
    const before = (await listJobs()).length;
    const second = await runOk("manual");
    expect(await listJobs()).toHaveLength(before);
    expect(second.status).toBe("done");
  });

  it("exposes runs over the API and refuses to start a second while one is running", async () => {
    let resolveScrape!: () => void;
    const hold = new Promise<void>((r) => { resolveScrape = r; });
    vi.spyOn(scrapersModule, "scrapeAll").mockImplementationOnce(async () => {
      await hold;
      return {
        results: [],
        listings: [],
        totalDurationMs: 10,
      };
    });

    const start = await refreshRoute(authed("/api/refresh", { method: "POST", body: { trigger: "manual" } }), params({}));
    expect(start.status).toBe(202);
    const { run } = (await start.json()) as { run: { id: string } };

    const again = await refreshRoute(authed("/api/refresh", { method: "POST", body: { trigger: "manual" } }), params({}));
    await expect(again.json()).resolves.toMatchObject({ started: false, reason: "running" });

    resolveScrape();
    await waitForRun(run.id);
    const poll = await runRoute(authed(`/api/refresh/${run.id}`), params({ id: run.id }));
    await expect(poll.json()).resolves.toMatchObject({ run: { id: run.id, status: "done" } });

    const missing = await runRoute(authed("/api/refresh/nope"), params({ id: "nope" }));
    expect(missing.status).toBe(404);
  });
});
