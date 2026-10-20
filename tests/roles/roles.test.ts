import { beforeEach, describe, expect, it } from "vitest";
import { DELETE as deleteRoleRoute, PATCH as patchRoleRoute } from "@/app/api/roles/[id]/route";
import { GET as getJobs } from "@/app/api/jobs/route";
import { POST as createRoleRoute } from "@/app/api/roles/route";
import { seedDatabase, SEED_ROLES } from "@/lib/db/seed";
import { mergeListings } from "@/lib/jobs/merge";
import { updateJobTracking } from "@/lib/jobs/queries";
import { listJobs } from "@/lib/jobs/queries";
import { MAX_ROLES, createRole, deleteRole, listRoles, reorderRoles, RoleLimitError, updateRole } from "@/lib/roles";
import { ROLE_PALETTE } from "@/lib/roles/palette";
import { waitForRun } from "@/lib/refresh/run";
import { anon, authed, listing, params, resetTables } from "../helpers";

beforeEach(() => resetTables());

describe("seed", () => {
  it("creates the three roles and the settings row once, and not again after deletion", () => {
    seedDatabase();
    expect(listRoles().map((r) => r.name)).toEqual(SEED_ROLES.map((r) => r.name));

    for (const role of listRoles()) deleteRole(role.id);
    seedDatabase();
    expect(listRoles()).toHaveLength(0);
  });
});

describe("roles", () => {
  it("assigns palette colours in order, skipping ones in use", () => {
    const a = createRole({ name: "A" });
    const b = createRole({ name: "B" });
    expect(a.color).toBe(ROLE_PALETTE[0]);
    expect(b.color).toBe(ROLE_PALETTE[1]);

    deleteRole(a.id);
    const c = createRole({ name: "C" });
    expect(c.color).toBe(ROLE_PALETTE[0]);
  });

  it("caps at 10 active roles; archived roles do not count", () => {
    for (let i = 0; i < MAX_ROLES; i += 1) createRole({ name: `Role ${i}` });
    expect(() => createRole({ name: "One too many" })).toThrow(RoleLimitError);

    // Archive one by deleting a role that has a tracked job.
    const victim = listRoles()[0]!;
    mergeListings([listing()], { roleId: victim.id, now: Date.now(), provider: null, model: null });
    updateJobTracking(listJobs()[0]!.id, { status: "saved" });
    expect(deleteRole(victim.id).kind).toBe("archived");

    expect(() => createRole({ name: "Now fits" })).not.toThrow();
  });

  it("renames, edits keywords, disables, and reorders", () => {
    const a = createRole({ name: "A" });
    const b = createRole({ name: "B" });
    const c = createRole({ name: "C" });

    const renamed = updateRole(a.id, { name: "  Comms  ", keywords: "PR, press", enabled: false });
    expect(renamed.name).toBe("Comms");
    expect(renamed.keywords).toBe("PR, press");
    expect(renamed.enabled).toBe(false);

    reorderRoles([c.id, a.id]);
    expect(listRoles().map((r) => r.id)).toEqual([c.id, a.id, b.id]);
  });
});

describe("deleting a role (brief 2.2)", () => {
  it("removes the role and its untracked jobs when nothing is tracked", () => {
    const role = createRole({ name: "Temp" });
    mergeListings([listing(), listing()], { roleId: role.id, now: Date.now(), provider: null, model: null });

    const outcome = deleteRole(role.id);
    expect(outcome).toEqual({ kind: "deleted", untrackedRemoved: 2 });
    expect(listRoles({ includeArchived: true })).toHaveLength(0);
    expect(listJobs()).toHaveLength(0);
  });

  it("archives the role, keeps tracked jobs, and deletes untracked ones", () => {
    const role = createRole({ name: "Temp" });
    mergeListings([listing(), listing(), listing()], { roleId: role.id, now: Date.now(), provider: null, model: null });
    const [tracked, alsoTracked] = listJobs();
    updateJobTracking(tracked!.id, { status: "applied" });
    updateJobTracking(alsoTracked!.id, { status: "hidden" }); // "Not for me" is still a status she set

    const outcome = deleteRole(role.id);
    expect(outcome).toEqual({ kind: "archived", trackedKept: 2, untrackedRemoved: 1 });

    expect(listRoles()).toHaveLength(0);
    const archived = listRoles({ includeArchived: true });
    expect(archived).toHaveLength(1);
    expect(archived[0]?.archived).toBe(true);
    expect(archived[0]?.enabled).toBe(false);

    const remaining = listJobs();
    expect(remaining).toHaveLength(2);
    expect(remaining.every((j) => j.roleId === role.id)).toBe(true);
  });
});

describe("roles API", () => {
  it("rejects anonymous requests", async () => {
    const response = await createRoleRoute(anon("/api/roles", { method: "POST", body: { name: "X" } }), params({}));
    expect(response.status).toBe(401);
  });

  it("creates a role and starts a search for just that role", async () => {
    seedDatabase();
    const response = await createRoleRoute(authed("/api/roles", { method: "POST", body: { name: "Fundraising", keywords: "grants" } }), params({}));
    expect(response.status).toBe(201);

    const body = (await response.json()) as { role: { id: string; name: string }; run: { id: string; progress: Record<string, unknown> } };
    expect(body.role.name).toBe("Fundraising");
    expect(Object.keys(body.run.progress)).toEqual([body.role.id]);

    await waitForRun(body.run.id);
    const jobsRes = await getJobs(authed("/api/jobs"), params({}));
    const { jobs } = (await jobsRes.json()) as { jobs: { roleId: string }[] };
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.roleId === body.role.id)).toBe(true);
  });

  it("validates input and rejects unknown fields", async () => {
    const empty = await createRoleRoute(authed("/api/roles", { method: "POST", body: { name: "   " } }), params({}));
    expect(empty.status).toBe(400);
    const extra = await createRoleRoute(authed("/api/roles", { method: "POST", body: { name: "X", color: "#fff" } }), params({}));
    expect(extra.status).toBe(400);
  });

  it("returns 409 at the role cap and 404 for a missing role", async () => {
    for (let i = 0; i < MAX_ROLES; i += 1) createRole({ name: `R${i}` });
    const capped = await createRoleRoute(authed("/api/roles", { method: "POST", body: { name: "Extra" } }), params({}));
    expect(capped.status).toBe(409);
    await expect(capped.json()).resolves.toMatchObject({ message: expect.stringMatching(/up to 10/) });

    const missing = await patchRoleRoute(authed("/api/roles/nope", { method: "PATCH", body: { name: "Y" } }), params({ id: "nope" }));
    expect(missing.status).toBe(404);
    const gone = await deleteRoleRoute(authed("/api/roles/nope", { method: "DELETE" }), params({ id: "nope" }));
    expect(gone.status).toBe(404);
  });
});
