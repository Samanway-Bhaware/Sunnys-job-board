import { beforeEach, describe, expect, it } from "vitest";
import { POST as refreshRoute } from "@/app/api/refresh/route";
import { getDb } from "@/lib/db";
import { refreshRuns } from "@/lib/db/schema";
import { seedDatabase } from "@/lib/db/seed";
import { resetEnvCache } from "@/lib/env";
import { LOCK_STALE_MS, acquireLock, capReached, cooldownRemaining, lockHolder, releaseLock, usageFor } from "@/lib/refresh/policy";
import { runRefreshAndWait, startRefresh } from "@/lib/refresh/run";
import { markRefreshCompleted } from "@/lib/settings";
import { authed, params, resetTables } from "../helpers";

const NOW = Date.UTC(2026, 8, 14, 10, 0, 0);

beforeEach(async () => {
  await resetTables();
  await seedDatabase();
  process.env.REFRESH_COOLDOWN_MINUTES = "120";
  resetEnvCache();
});

describe("cooldown", () => {
  it("a visit refresh is skipped inside the window and allowed after it", async () => {
    expect(await cooldownRemaining(NOW)).toBe(0);
    await markRefreshCompleted(NOW);
    expect(await cooldownRemaining(NOW + 30 * 60_000)).toBe(90 * 60_000);
    expect(await cooldownRemaining(NOW + 121 * 60_000)).toBe(0);
  });

  it("REFRESH_COOLDOWN_MINUTES=0 means every visit refreshes", async () => {
    process.env.REFRESH_COOLDOWN_MINUTES = "0";
    resetEnvCache();
    await markRefreshCompleted(NOW);
    expect(await cooldownRemaining(NOW + 1)).toBe(0);
  });

  it("visit respects it; manual bypasses it", async () => {
    const first = await runRefreshAndWait({ trigger: "manual" });
    expect(first.started).toBe(true);

    const visit = await startRefresh({ trigger: "visit" });
    expect(visit).toMatchObject({ started: false, reason: "cooldown" });
    if (!visit.started && visit.reason === "cooldown") expect(visit.retryInMs).toBeGreaterThan(0);

    const manual = await runRefreshAndWait({ trigger: "manual" });
    expect(manual.started).toBe(true);
  });
});

describe("scraping policy", () => {
  it("scrapers are free and uncapped", () => {
    expect(usageFor().applies).toBe(false);
    expect(capReached()).toBe(false);
  });
});

describe("lock", () => {
  it("one run at a time; a second start reports the running one", async () => {
    await getDb().insert(refreshRuns).values({ id: "run-a", trigger: "manual", startedAt: NOW, finishedAt: null, status: "running", progress: "{}", usedDefaultKey: true, error: null });
    expect(await acquireLock("run-a", NOW)).toEqual({ acquired: true });
    expect(await acquireLock("run-b", NOW + 1000)).toEqual({ acquired: false, heldBy: "run-a" });
    expect(await lockHolder()).toBe("run-a");

    await releaseLock("run-b");
    expect(await lockHolder()).toBe("run-a");
    await releaseLock("run-a");
    expect(await lockHolder()).toBeNull();
  });

  it("a lock older than 10 minutes is stale: the run is failed and the lock taken over", async () => {
    await getDb().insert(refreshRuns).values({ id: "run-old", trigger: "manual", startedAt: NOW, finishedAt: null, status: "running", progress: "{}", usedDefaultKey: true, error: null });
    await acquireLock("run-old", NOW);

    expect(await acquireLock("run-new", NOW + LOCK_STALE_MS - 1)).toEqual({ acquired: false, heldBy: "run-old" });
    expect(await acquireLock("run-new", NOW + LOCK_STALE_MS)).toEqual({ acquired: true });

    const rows = await getDb().select().from(refreshRuns);
    const old = rows.find((r) => r.id === "run-old");
    expect(old?.status).toBe("failed");
    expect(old?.error).toMatch(/10 minutes/);
  });

  it("a finished run's lock is released, so the next run proceeds", async () => {
    const a = await runRefreshAndWait({ trigger: "manual" });
    expect(a.started).toBe(true);
    expect(await lockHolder()).toBeNull();
    const b = await runRefreshAndWait({ trigger: "manual" });
    expect(b.started).toBe(true);
  });
});

describe("POST /api/refresh outcomes", () => {
  it("returns 202 when started and 200 with a reason when not", async () => {
    const started = await refreshRoute(authed("/api/refresh", { method: "POST", body: { trigger: "manual" } }), params({}));
    expect(started.status).toBe(202);
    const body = (await started.json()) as { run: { id: string } };
    const { waitForRun } = await import("@/lib/refresh/run");
    await waitForRun(body.run.id);

    const cooled = await refreshRoute(authed("/api/refresh", { method: "POST", body: { trigger: "visit" } }), params({}));
    expect(cooled.status).toBe(200);
    await expect(cooled.json()).resolves.toMatchObject({ started: false, reason: "cooldown" });
  });
});
