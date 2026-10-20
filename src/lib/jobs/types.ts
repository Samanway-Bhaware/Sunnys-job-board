/** Shared vocabulary for listings. Kept as const tuples so zod and the UI share them. */

export const WORK_MODES = ["remote", "hybrid", "onsite", "unknown"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const CONTRACTS = ["full_time", "part_time", "unknown"] as const;
export type Contract = (typeof CONTRACTS)[number];

export const SPONSORSHIPS = ["offered", "not_offered", "not_stated"] as const;
export type Sponsorship = (typeof SPONSORSHIPS)[number];

export const LINK_STATUSES = ["verified", "unverified", "unchecked"] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

/** '' is "Not started". Anything else means she is tracking the role. */
export const STATUSES = ["", "saved", "applied", "interview", "offer", "rejected", "hidden"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  "": "Not started",
  saved: "Saved",
  applied: "Applied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  hidden: "Not for me",
};

export function isTracked(status: string): boolean {
  return status !== "";
}

/** Every string the LLM can influence is capped (brief section 4.6). */
export const MAX_LEN = {
  org: 160,
  title: 200,
  location: 160,
  hours: 80,
  salary: 120,
  evidence: 240,
  url: 2048,
  source: 120,
  notes: 2000,
  roleName: 60,
  roleKeywords: 300,
  sector: 200,
  locationEntry: 80,
  searchNotes: 500,
} as const;

/**
 * A listing after normalisation and before it is merged into the database.
 * This is the shape the Phase 3 pipeline produces and the merge step consumes.
 */
export interface NormalisedListing {
  org: string;
  title: string;
  locationText: string;
  locationNorm: string;
  workMode: WorkMode;
  contract: Contract;
  hoursText: string;
  salaryText: string;
  salaryMin: number | null;
  salaryMax: number | null;
  sponsorship: Sponsorship;
  sponsorshipEvidence: string;
  postedDate: string | null;
  closingDate: string | null;
  url: string;
  canonicalUrl: string;
  source: string;
  cited: boolean;
  linkStatus: LinkStatus;
  /** Set by pipeline step 7 (sponsor register). */
  licensedSponsor?: boolean;
  sponsorMatchName?: string | null;
}

/** What the client receives for one listing. Never includes anything secret. */
export interface JobView {
  id: string;
  roleId: string;
  title: string;
  org: string;
  locationText: string;
  locationNorm: string;
  workMode: WorkMode;
  contract: Contract;
  hoursText: string;
  salaryText: string;
  salaryMin: number | null;
  salaryMax: number | null;
  sponsorship: Sponsorship;
  sponsorshipEvidence: string;
  licensedSponsor: boolean;
  sponsorMatchName: string | null;
  postedDate: string | null;
  closingDate: string | null;
  url: string;
  source: string;
  cited: boolean;
  linkStatus: LinkStatus;
  firstSeen: number;
  lastSeen: number;
  status: Status;
  notes: string;
  appliedAt: number | null;
}

export interface RoleView {
  id: string;
  name: string;
  keywords: string;
  color: string;
  enabled: boolean;
  sortOrder: number;
  archived: boolean;
}

export interface ScopeView {
  sector: string;
  locations: string[];
  notes: string;
}
