import { beforeEach, describe, expect, it } from "vitest";
import { PATCH as patchJob } from "@/app/api/jobs/[id]/route";
import { GET as getJobs } from "@/app/api/jobs/route";
import { mergeListings } from "@/lib/jobs/merge";
import { listJobs, updateJobTracking } from "@/lib/jobs/queries";
import { createRole } from "@/lib/roles";
import { getSettings, markRefreshCompleted } from "@/lib/settings";
import { authed, listing, params, resetTables } from "../helpers";

let jobId: string;

beforeEach(async () => {
  await resetTables();
  const role = await createRole({ name: "Comms" });
  await mergeListings([listing()], { roleId: role.id, now: 1000, provider: null, model: null });
  const allJobs = await listJobs();
  jobId = allJobs[0]!.id;
});

describe("tracker (brief 2.8)", () => {
  it("sets applied_at the first time the status becomes Applied, and keeps it", async () => {
    const first = await updateJobTracking(jobId, { status: "applied" }, 5000);
    expect(first.appliedAt).toBe(5000);

    const later = await updateJobTracking(jobId, { status: "interview" }, 6000);
    expect(later.appliedAt).toBe(5000);

    const again = await updateJobTracking(jobId, { status: "applied" }, 7000);
    expect(again.appliedAt).toBe(5000);
  });

  it("does not set applied_at for other statuses", async () => {
    const res = await updateJobTracking(jobId, { status: "saved" });
    expect(res.appliedAt).toBeNull();
  });

  it("PATCH accepts only status and notes", async () => {
    const ok = await patchJob(authed(`/api/jobs/${jobId}`, { method: "PATCH", body: { status: "saved", notes: "call back" } }), params({ id: jobId }));
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({ job: { status: "saved", notes: "call back" } });

    const forbidden = await patchJob(authed(`/api/jobs/${jobId}`, { method: "PATCH", body: { title: "Hacked" } }), params({ id: jobId }));
    expect(forbidden.status).toBe(400);

    const badStatus = await patchJob(authed(`/api/jobs/${jobId}`, { method: "PATCH", body: { status: "ghosted" } }), params({ id: jobId }));
    expect(badStatus.status).toBe(400);

    const missing = await patchJob(authed(`/api/jobs/nope`, { method: "PATCH", body: { status: "saved" } }), params({ id: "nope" }));
    expect(missing.status).toBe(404);
  });
});

describe("'New' badge data (brief 2.5)", () => {
  it("exposes seen_up_to as null before any refresh, so the first visit shows no badges", async () => {
    const response = await getJobs(authed("/api/jobs"), params({}));
    const body = (await response.json()) as { seenUpTo: number | null };
    expect(body.seenUpTo).toBeNull();
  });

  it("moves seen_up_to to the completion time of a refresh", async () => {
    await markRefreshCompleted(2000);
    expect((await getSettings()).seenUpTo).toBe(2000);
    expect((await getSettings()).lastRefreshAt).toBe(2000);

    // A listing first seen after 2000 is "new" on the next visit; one seen at 1000 is not.
    const role = await createRole({ name: "Marketing" });
    await mergeListings([listing()], { roleId: role.id, now: 3000, provider: null, model: null });

    const response = await getJobs(authed("/api/jobs"), params({}));
    const body = (await response.json()) as { seenUpTo: number; jobs: { firstSeen: number }[] };
    const newSince = body.seenUpTo;
    const isNew = (j: { firstSeen: number }) => newSince > 0 && j.firstSeen > newSince;
    expect(body.jobs.map(isNew).sort()).toEqual([false, true]);
  });
});
