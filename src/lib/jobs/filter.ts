import {
  CONTRACTS,
  WORK_MODES,
  type Contract,
  type JobView,
  type RoleView,
  type WorkMode,
} from "./types";

/**
 * Client-side filtering over stored data (brief section 2.6). Pure and
 * dependency-free so the board and the tests run exactly the same code.
 *
 * Search scope (what gets fetched) is a different thing and lives in Settings.
 */

export const SPONSORSHIP_FILTERS = ["any", "offered", "offered_or_licensed", "hide_ruled_out"] as const;
export type SponsorshipFilter = (typeof SPONSORSHIP_FILTERS)[number];

export const VIEWS = ["active", "tracking", "hidden"] as const;
export type View = (typeof VIEWS)[number];

export const SORTS = ["closing", "newest", "salary"] as const;
export type Sort = (typeof SORTS)[number];

export const ARCHIVED_TAB = "archived";
export const ALL_TAB = "all";

export interface Filters {
  /** "all", "archived", or a role id. */
  tab: string;
  /** Multi-select over `locationNorm`. */
  locations: string[];
  /** Free-text contains-match over `locationText`. */
  locationText: string;
  workModes: WorkMode[];
  contracts: Contract[];
  /** "Include roles where hours aren't stated" — default on. */
  includeUnknownHours: boolean;
  sponsorship: SponsorshipFilter;
  /** Text search over org, title, location. */
  query: string;
  view: View;
  hideClosed: boolean;
  sort: Sort;
}

export const DEFAULT_FILTERS: Filters = {
  tab: ALL_TAB,
  locations: [],
  locationText: "",
  workModes: [],
  contracts: [],
  includeUnknownHours: true,
  sponsorship: "any",
  query: "",
  view: "active",
  hideClosed: true,
  sort: "closing",
};

export function isClosed(job: Pick<JobView, "closingDate">, today: string): boolean {
  return job.closingDate !== null && job.closingDate < today;
}

export function applyFilters(
  jobs: JobView[],
  roles: RoleView[],
  filters: Filters,
  today: string,
): JobView[] {
  const archivedRoleIds = new Set(roles.filter((r) => r.archived).map((r) => r.id));
  const q = filters.query.trim().toLowerCase();
  const lq = filters.locationText.trim().toLowerCase();

  const visible = jobs.filter((job) => {
    // Tab
    if (filters.tab === ARCHIVED_TAB) {
      if (!archivedRoleIds.has(job.roleId)) return false;
    } else if (filters.tab === ALL_TAB) {
      if (archivedRoleIds.has(job.roleId)) return false;
    } else if (job.roleId !== filters.tab) {
      return false;
    }

    // Status view
    if (filters.view === "hidden") {
      if (job.status !== "hidden") return false;
    } else {
      if (job.status === "hidden") return false;
      if (filters.view === "tracking" && job.status === "") return false;
    }

    if (filters.hideClosed && isClosed(job, today)) return false;

    // Location
    if (filters.locations.length > 0 && !filters.locations.includes(job.locationNorm)) return false;
    if (lq && !job.locationText.toLowerCase().includes(lq)) return false;

    // Work mode
    if (filters.workModes.length > 0 && !filters.workModes.includes(job.workMode)) return false;

    // Contract: the checkbox governs unknowns whether or not a chip is pressed.
    if (job.contract === "unknown") {
      if (!filters.includeUnknownHours) return false;
    } else if (filters.contracts.length > 0 && !filters.contracts.includes(job.contract)) {
      return false;
    }

    // Sponsorship
    switch (filters.sponsorship) {
      case "offered":
        if (job.sponsorship !== "offered") return false;
        break;
      case "offered_or_licensed":
        if (job.sponsorship !== "offered" && !job.licensedSponsor) return false;
        break;
      case "hide_ruled_out":
        if (job.sponsorship === "not_offered") return false;
        break;
      case "any":
        break;
    }

    // Text search
    if (q && !`${job.org} ${job.title} ${job.locationText}`.toLowerCase().includes(q)) return false;

    return true;
  });

  return sortJobs(visible, filters.sort);
}

export function sortJobs(jobs: JobView[], sort: Sort): JobView[] {
  const copy = [...jobs];
  switch (sort) {
    case "newest":
      return copy.sort((a, b) => b.firstSeen - a.firstSeen);
    case "salary":
      return copy.sort((a, b) => {
        const av = a.salaryMax ?? a.salaryMin;
        const bv = b.salaryMax ?? b.salaryMin;
        if (av === null && bv === null) return b.firstSeen - a.firstSeen;
        if (av === null) return 1;
        if (bv === null) return -1;
        return bv - av || b.firstSeen - a.firstSeen;
      });
    case "closing":
    default:
      return copy.sort((a, b) => {
        const ac = a.closingDate ?? "9999-99-99";
        const bc = b.closingDate ?? "9999-99-99";
        return ac === bc ? b.firstSeen - a.firstSeen : ac < bc ? -1 : 1;
      });
  }
}

/** How many filters are narrowing the list. The tab and sort are navigation, not filters. */
export function activeFilterCount(f: Filters): number {
  let n = 0;
  if (f.locations.length > 0) n += 1;
  if (f.locationText.trim()) n += 1;
  if (f.workModes.length > 0) n += 1;
  if (f.contracts.length > 0) n += 1;
  if (!f.includeUnknownHours) n += 1;
  if (f.sponsorship !== "any") n += 1;
  if (f.query.trim()) n += 1;
  if (f.view !== "active") n += 1;
  if (!f.hideClosed) n += 1;
  return n;
}

/* ---------- URL and localStorage persistence ---------- */

const KEYS = {
  tab: "tab",
  locations: "loc",
  locationText: "lq",
  workModes: "mode",
  contracts: "ct",
  includeUnknownHours: "unk",
  sponsorship: "sp",
  query: "q",
  view: "view",
  hideClosed: "closed",
  sort: "sort",
} as const;

export function filtersToParams(f: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.tab !== DEFAULT_FILTERS.tab) p.set(KEYS.tab, f.tab);
  if (f.locations.length) p.set(KEYS.locations, f.locations.join(","));
  if (f.locationText.trim()) p.set(KEYS.locationText, f.locationText.trim());
  if (f.workModes.length) p.set(KEYS.workModes, f.workModes.join(","));
  if (f.contracts.length) p.set(KEYS.contracts, f.contracts.join(","));
  if (!f.includeUnknownHours) p.set(KEYS.includeUnknownHours, "0");
  if (f.sponsorship !== "any") p.set(KEYS.sponsorship, f.sponsorship);
  if (f.query.trim()) p.set(KEYS.query, f.query.trim());
  if (f.view !== "active") p.set(KEYS.view, f.view);
  if (!f.hideClosed) p.set(KEYS.hideClosed, "0");
  if (f.sort !== "closing") p.set(KEYS.sort, f.sort);
  return p;
}

function pick<T extends string>(values: readonly T[], value: string | null, fallback: T): T {
  return value !== null && (values as readonly string[]).includes(value) ? (value as T) : fallback;
}

function pickList<T extends string>(values: readonly T[], raw: string | null): T[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => (values as readonly string[]).includes(s));
}

export function filtersFromParams(p: URLSearchParams): Filters {
  return {
    tab: p.get(KEYS.tab) || DEFAULT_FILTERS.tab,
    locations: (p.get(KEYS.locations) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    locationText: p.get(KEYS.locationText) ?? "",
    workModes: pickList(WORK_MODES, p.get(KEYS.workModes)),
    contracts: pickList(CONTRACTS, p.get(KEYS.contracts)),
    includeUnknownHours: p.get(KEYS.includeUnknownHours) !== "0",
    sponsorship: pick(SPONSORSHIP_FILTERS, p.get(KEYS.sponsorship), "any"),
    query: p.get(KEYS.query) ?? "",
    view: pick(VIEWS, p.get(KEYS.view), "active"),
    hideClosed: p.get(KEYS.hideClosed) !== "0",
    sort: pick(SORTS, p.get(KEYS.sort), "closing"),
  };
}

/** Parse from a stored JSON string, tolerating anything malformed. */
export function filtersFromJson(raw: string | null): Filters | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const p = new URLSearchParams();
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") p.set(key, value);
    }
    return filtersFromParams(p);
  } catch {
    return null;
  }
}

export function filtersToJson(f: Filters): string {
  return JSON.stringify(Object.fromEntries(filtersToParams(f).entries()));
}
