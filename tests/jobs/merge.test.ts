import { beforeEach, describe, expect, it } from "vitest";
import { DAY_MS, todayString } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { applyRetention, mergeListings, STALE_DAYS } from "@/lib/jobs/merge";
import { updateJobTracking } from "@/lib/jobs/queries";
import { createRole } from "@/lib/roles";
import { listing, resetTables } from "../helpers";

const NOW = Date.UTC(2026, 8, 14, 12, 0, 0);
const day = (offset: number) => todayString(NOW + offset * DAY_MS);

let roleId: string;

beforeEach(async () => {
  await resetTables();
  const role = await createRole({ name: "Communications" }, NOW);
  roleId = role.id;
});

const ctx = (now = NOW) => ({ roleId, now, provider: "mock", model: "mock-model" });
const all = async () => await getDb().select().from(jobs);

describe("mergeListings", () => {
  it("inserts new listings with first_seen = last_seen = now and no status", async () => {
    const result = await mergeListings([listing(), listing()], ctx());
    expect(result).toEqual({ added: 2, updated: 0 });

    const rows = await all();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.firstSeen).toBe(NOW);
      expect(row.lastSeen).toBe(NOW);
      expect(row.status).toBe("");
      expect(row.notes).toBe("");
      expect(row.appliedAt).toBeNull();
      expect(row.roleId).toBe(roleId);
    }
  });

  it("matches on canonical URL and bumps last_seen without touching first_seen", async () => {
    const first = listing({ url: "https://a.example/job", canonicalUrl: "https://a.example/job" });
    await mergeListings([first], ctx(NOW));

    const again = listing({ url: "https://a.example/job?utm_source=x", canonicalUrl: "https://a.example/job", org: "Different Org Name", title: "Different title" });
    const result = await mergeListings([again], ctx(NOW + DAY_MS));

    expect(result).toEqual({ added: 0, updated: 1 });
    const [row] = await all();
    expect(row?.firstSeen).toBe(NOW);
    expect(row?.lastSeen).toBe(NOW + DAY_MS);
  });

  it("falls back to normalised org + title when the URL differs", async () => {
    await mergeListings([listing({ org: "Forth Festival", title: "Communications Officer", url: "https://a.example/1", canonicalUrl: "https://a.example/1" })], ctx());
    const result = await mergeListings(
      [listing({ org: "FORTH FESTIVAL", title: "Communications  officer!", url: "https://b.example/2", canonicalUrl: "https://b.example/2" })],
      ctx(NOW + 1000),
    );
    expect(result).toEqual({ added: 0, updated: 1 });
    expect(await all()).toHaveLength(1);
  });

  it("fills empty fields on an existing listing but never overwrites populated ones", async () => {
    await mergeListings(
      [listing({ url: "https://a.example/j", canonicalUrl: "https://a.example/j", hoursText: "", salaryText: "", salaryMin: null, salaryMax: null, workMode: "unknown", contract: "unknown", sponsorship: "not_stated", closingDate: null, locationText: "Edinburgh" })],
      ctx(),
    );
    await mergeListings(
      [listing({ url: "https://a.example/j", canonicalUrl: "https://a.example/j", hoursText: "3 days/wk", salaryText: "£28k", salaryMin: 28000, salaryMax: 28000, workMode: "remote", contract: "part_time", sponsorship: "offered", closingDate: "2030-01-01", locationText: "Glasgow" })],
      ctx(NOW + 1),
    );

    const [row] = await all();
    expect(row?.hoursText).toBe("3 days/wk");
    expect(row?.salaryMin).toBe(28000);
    expect(row?.workMode).toBe("remote");
    expect(row?.contract).toBe("part_time");
    expect(row?.sponsorship).toBe("offered");
    expect(row?.closingDate).toBe("2030-01-01");
    // Was already populated: not overwritten.
    expect(row?.locationText).toBe("Edinburgh");
  });

  it("never touches her status, notes or applied date", async () => {
    await mergeListings([listing({ url: "https://a.example/j", canonicalUrl: "https://a.example/j" })], ctx());
    const [row] = await all();
    await updateJobTracking(row!.id, { status: "applied", notes: "Spoke to Sam" }, NOW + 5);

    await mergeListings([listing({ url: "https://a.example/j", canonicalUrl: "https://a.example/j" })], ctx(NOW + DAY_MS));

    const [after] = await all();
    expect(after?.status).toBe("applied");
    expect(after?.notes).toBe("Spoke to Sam");
    expect(after?.appliedAt).toBe(NOW + 5);
  });

  it("dedupes globally, so a listing found by two roles appears once", async () => {
    const other = (await createRole({ name: "Marketing" }, NOW)).id;
    const shared = listing({ url: "https://a.example/shared", canonicalUrl: "https://a.example/shared" });
    await mergeListings([shared], { roleId, now: NOW, provider: null, model: null });
    await mergeListings([shared], { roleId: other, now: NOW + 1, provider: null, model: null });

    const rows = await all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.roleId).toBe(roleId);
  });
});

describe("applyRetention", () => {
  it("removes untracked listings whose closing date has passed", async () => {
    await mergeListings([listing({ closingDate: day(-1) }), listing({ closingDate: day(0) }), listing({ closingDate: day(+1) }), listing({ closingDate: null })], ctx());
    const removed = await applyRetention(NOW);
    expect(removed).toBe(1);
    const rows = await all();
    expect(rows.map((r) => r.closingDate).sort()).toEqual([null, day(0), day(+1)].sort());
  });

  it("removes untracked listings not seen for 21 days", async () => {
    await mergeListings([listing()], ctx(NOW - (STALE_DAYS + 1) * DAY_MS));
    await mergeListings([listing()], ctx(NOW - (STALE_DAYS - 1) * DAY_MS));
    expect(await applyRetention(NOW)).toBe(1);
    expect(await all()).toHaveLength(1);
  });

  it("always keeps tracked listings, closed or stale", async () => {
    await mergeListings([listing({ closingDate: day(-30) })], ctx(NOW - 60 * DAY_MS));
    const [row] = await all();
    await updateJobTracking(row!.id, { status: "saved" });

    expect(await applyRetention(NOW)).toBe(0);
    expect(await all()).toHaveLength(1);
  });
});
