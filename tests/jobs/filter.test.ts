import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  applyFilters,
  filtersFromJson,
  filtersFromParams,
  filtersToJson,
  filtersToParams,
  type Filters,
} from "@/lib/jobs/filter";
import type { JobView, RoleView } from "@/lib/jobs/types";

/**
 * Brief Phase 2: every filter combination on a fixture set. The set below is
 * built so each filter has at least one job it keeps and one it drops.
 */

const TODAY = "2026-09-14";

const roles: RoleView[] = [
  { id: "comms", name: "Communications", keywords: "", color: "#1", enabled: true, sortOrder: 0, archived: false },
  { id: "mktg", name: "Marketing", keywords: "", color: "#2", enabled: true, sortOrder: 1, archived: false },
  { id: "old", name: "Fundraising", keywords: "", color: "#3", enabled: false, sortOrder: 2, archived: true },
];

let n = 0;
function job(over: Partial<JobView>): JobView {
  n += 1;
  return {
    id: `j${n}`,
    roleId: "comms",
    title: `Title ${n}`,
    org: `Org ${n}`,
    locationText: "Edinburgh",
    locationNorm: "Edinburgh",
    workMode: "hybrid",
    contract: "part_time",
    hoursText: "",
    salaryText: "",
    salaryMin: null,
    salaryMax: null,
    sponsorship: "not_stated",
    sponsorshipEvidence: "",
    licensedSponsor: false,
    sponsorMatchName: null,
    postedDate: null,
    closingDate: null,
    url: "https://x.example",
    source: "",
    cited: false,
    linkStatus: "unchecked",
    firstSeen: 1000 + n,
    lastSeen: 1000 + n,
    status: "",
    notes: "",
    appliedAt: null,
    ...over,
  };
}

const J = {
  edinburghPT: job({ id: "edinburghPT", locationNorm: "Edinburgh", locationText: "Edinburgh (hybrid)", workMode: "hybrid", contract: "part_time", salaryMax: 30000 }),
  remoteFT: job({ id: "remoteFT", locationNorm: "Remote", locationText: "Remote (UK)", workMode: "remote", contract: "full_time", sponsorship: "offered", salaryMax: 45000, closingDate: "2026-09-20" }),
  glasgowOnsite: job({ id: "glasgowOnsite", roleId: "mktg", locationNorm: "Glasgow", locationText: "Glasgow city centre", workMode: "onsite", contract: "full_time", sponsorship: "not_offered", salaryMax: 28000, closingDate: "2026-10-01" }),
  unknownHours: job({ id: "unknownHours", roleId: "mktg", locationNorm: "Dundee", locationText: "Dundee", workMode: "unknown", contract: "unknown", licensedSponsor: true }),
  closed: job({ id: "closed", closingDate: "2026-09-01" }),
  saved: job({ id: "saved", status: "saved", closingDate: "2026-09-16" }),
  applied: job({ id: "applied", status: "applied", roleId: "mktg" }),
  hidden: job({ id: "hidden", status: "hidden" }),
  archived: job({ id: "archived", roleId: "old", status: "interview" }),
  archivedUntracked: job({ id: "archivedUntracked", roleId: "old" }),
};
const jobs = Object.values(J);

const ids = (f: Partial<Filters>) => applyFilters(jobs, roles, { ...DEFAULT_FILTERS, ...f }, TODAY).map((j) => j.id);

describe("applyFilters — tabs", () => {
  it("All shows every open, non-hidden job from active roles", () => {
    expect(ids({})).toEqual(expect.arrayContaining(["edinburghPT", "remoteFT", "glasgowOnsite", "unknownHours", "saved", "applied"]));
    expect(ids({})).not.toContain("closed");
    expect(ids({})).not.toContain("hidden");
    expect(ids({})).not.toContain("archived");
  });

  it("a role tab shows only that role", () => {
    expect(ids({ tab: "mktg" }).sort()).toEqual(["applied", "glasgowOnsite", "unknownHours"]);
  });

  it("Archived shows jobs from archived roles, including untracked ones still in the table", () => {
    expect(ids({ tab: "archived" }).sort()).toEqual(["archived", "archivedUntracked"]);
  });
});

describe("applyFilters — location", () => {
  it("multi-select over normalised locations", () => {
    expect(ids({ locations: ["Remote"] })).toEqual(["remoteFT"]);
    expect(ids({ locations: ["Remote", "Glasgow"] }).sort()).toEqual(["glasgowOnsite", "remoteFT"]);
  });

  it("free-text contains-match over the raw location", () => {
    expect(ids({ locationText: "centre" })).toEqual(["glasgowOnsite"]);
    expect(ids({ locationText: "uk" })).toEqual(["remoteFT"]);
  });

  it("combines both", () => {
    expect(ids({ locations: ["Glasgow", "Remote"], locationText: "glasgow" })).toEqual(["glasgowOnsite"]);
  });
});

describe("applyFilters — work mode and contract", () => {
  it("work mode chips", () => {
    expect(ids({ workModes: ["remote"] })).toEqual(["remoteFT"]);
    expect(ids({ workModes: ["onsite", "remote"] }).sort()).toEqual(["glasgowOnsite", "remoteFT"]);
    // Unknown work mode never matches a pressed chip.
    expect(ids({ workModes: ["hybrid"] })).not.toContain("unknownHours");
  });

  it("contract chips include unknown-hours jobs by default", () => {
    const fullTime = ids({ contracts: ["full_time"] });
    expect(fullTime).toContain("remoteFT");
    expect(fullTime).toContain("glasgowOnsite");
    expect(fullTime).toContain("unknownHours");
    expect(fullTime).not.toContain("edinburghPT");
  });

  it("unticking 'include unstated hours' drops unknown-contract jobs, with or without chips", () => {
    expect(ids({ contracts: ["full_time"], includeUnknownHours: false })).not.toContain("unknownHours");
    expect(ids({ includeUnknownHours: false })).not.toContain("unknownHours");
    expect(ids({ includeUnknownHours: false })).toContain("edinburghPT");
  });

  it("part-time chip", () => {
    const pt = ids({ contracts: ["part_time"], includeUnknownHours: false });
    expect(pt).toContain("edinburghPT");
    expect(pt).not.toContain("remoteFT");
  });
});

describe("applyFilters — sponsorship", () => {
  it("Any", () => {
    expect(ids({ sponsorship: "any" })).toContain("glasgowOnsite");
  });
  it("Offered in listing", () => {
    expect(ids({ sponsorship: "offered" })).toEqual(["remoteFT"]);
  });
  it("Offered or employer is a licensed sponsor", () => {
    expect(ids({ sponsorship: "offered_or_licensed" }).sort()).toEqual(["remoteFT", "unknownHours"]);
  });
  it("Hide roles that rule out sponsorship", () => {
    const shown = ids({ sponsorship: "hide_ruled_out" });
    expect(shown).not.toContain("glasgowOnsite");
    expect(shown).toContain("edinburghPT");
    expect(shown).toContain("remoteFT");
  });
});

describe("applyFilters — text, view, closed", () => {
  it("text search over org, title and location", () => {
    expect(ids({ query: "glasgow" })).toEqual(["glasgowOnsite"]);
    expect(ids({ query: J.edinburghPT.org.toUpperCase() })).toEqual(["edinburghPT"]);
    expect(ids({ query: "nothing-matches" })).toEqual([]);
  });

  it("status views", () => {
    expect(ids({ view: "tracking" }).sort()).toEqual(["applied", "saved"]);
    expect(ids({ view: "hidden" })).toEqual(["hidden"]);
    expect(ids({ view: "active" })).not.toContain("hidden");
  });

  it("hide closed on by default; off shows closed", () => {
    expect(ids({})).not.toContain("closed");
    expect(ids({ hideClosed: false })).toContain("closed");
  });
});

describe("applyFilters — sort", () => {
  it("closing soonest by default, unknown closing last, ties newest first", () => {
    const order = ids({ hideClosed: false });
    expect(order.indexOf("closed")).toBeLessThan(order.indexOf("saved"));
    expect(order.indexOf("saved")).toBeLessThan(order.indexOf("remoteFT"));
    expect(order.indexOf("remoteFT")).toBeLessThan(order.indexOf("glasgowOnsite"));
    const noClosing = ["edinburghPT", "unknownHours", "applied"];
    for (const id of noClosing) expect(order.indexOf(id)).toBeGreaterThan(order.indexOf("glasgowOnsite"));
  });

  it("newest first", () => {
    const order = ids({ sort: "newest" });
    expect(order[0]).toBe("applied"); // highest firstSeen among visible
  });

  it("salary high to low, unparseable last", () => {
    const order = ids({ sort: "salary" });
    expect(order.slice(0, 3)).toEqual(["remoteFT", "edinburghPT", "glasgowOnsite"]);
    expect(order.indexOf("unknownHours")).toBeGreaterThan(2);
  });
});

describe("applyFilters — combinations", () => {
  it("remote + part-time + hide ruled out + tracking view", () => {
    expect(ids({ workModes: ["remote"], contracts: ["part_time"], sponsorship: "hide_ruled_out", view: "tracking" })).toEqual([]);
  });
  it("mktg tab + full-time + hide unknown + not_offered visible under Any", () => {
    expect(ids({ tab: "mktg", contracts: ["full_time"], includeUnknownHours: false })).toEqual(["glasgowOnsite"]);
  });
  it("archived tab + tracking view", () => {
    expect(ids({ tab: "archived", view: "tracking" })).toEqual(["archived"]);
  });
});

describe("filter persistence", () => {
  const custom: Filters = {
    tab: "mktg",
    locations: ["Remote", "Glasgow"],
    locationText: "centre",
    workModes: ["remote", "onsite"],
    contracts: ["part_time"],
    includeUnknownHours: false,
    sponsorship: "hide_ruled_out",
    query: "officer",
    view: "tracking",
    hideClosed: false,
    sort: "salary",
  };

  it("round-trips through URL params", () => {
    expect(filtersFromParams(filtersToParams(custom))).toEqual(custom);
  });

  it("round-trips through localStorage JSON", () => {
    expect(filtersFromJson(filtersToJson(custom))).toEqual(custom);
  });

  it("defaults produce an empty query string", () => {
    expect(filtersToParams(DEFAULT_FILTERS).toString()).toBe("");
  });

  it("ignores garbage values", () => {
    const f = filtersFromParams(new URLSearchParams("mode=teleport,remote&sp=nope&sort=weird&view=x&unk=0"));
    expect(f.workModes).toEqual(["remote"]);
    expect(f.sponsorship).toBe("any");
    expect(f.sort).toBe("closing");
    expect(f.view).toBe("active");
    expect(f.includeUnknownHours).toBe(false);
    expect(filtersFromJson("not json")).toBeNull();
  });

  it("counts active filters, excluding tab and sort", () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, tab: "mktg", sort: "newest" })).toBe(0);
    expect(activeFilterCount(custom)).toBe(9);
  });
});
