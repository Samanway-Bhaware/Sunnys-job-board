/**
 * FreeHire public API client (https://github.com/strelov1/freehire).
 *
 * Docs: https://freehire.me/docs/api
 * Endpoint: GET https://freehire.me/api/v1/jobs/search
 * Auth: None required for public search/job endpoints (optional Bearer token supported).
 */

import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";
import type { Contract, Sponsorship, WorkMode } from "@/lib/jobs/types";
import type { ScrapedJob, Scraper, ScrapeQuery, ScraperResult } from "./types";

const PAGE_LIMIT = 100;
const TIMEOUT_MS = 15_000;

export interface FreeHireEnrichment {
  summary?: string | null;
  seniority?: string | null;
  category?: string | null;
  employment_type?: string | null;
  relocation?: string | null;
  visa_sponsorship?: boolean | null;
  experience_years_min?: number | null;
  english_level?: string | null;
  education_level?: string | null;
  domains?: string[] | null;
  posting_language?: string | null;
  company_type?: string | null;
  company_size?: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string | null;
  salary_period?: string | null;
}

export interface FreeHireJob {
  public_slug: string;
  source?: string | null;
  manually_added?: boolean;
  external_id?: string | null;
  url?: string | null;
  title: string;
  company: string;
  company_slug?: string | null;
  location?: string | null;
  description?: string | null;
  countries?: string[] | null;
  regions?: string[] | null;
  work_mode?: string | null;
  skills?: string[] | null;
  cities?: string[] | null;
  collections?: string[] | null;
  is_tech?: string | null;
  posted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  closed_at?: string | null;
  enrichment?: FreeHireEnrichment | null;
}

interface FreeHireSearchResponse {
  data?: FreeHireJob[];
  meta?: {
    total?: number;
    limit?: number;
    offset?: number;
    ignored_params?: string[];
  };
  error?: string;
}

const CURRENCY_SYMBOL: Record<string, string> = {
  GBP: "£",
  USD: "$",
  EUR: "€",
};

function toIsoDate(isoOrNull: string | null | undefined): string | null {
  if (!isoOrNull) return null;
  try {
    const d = new Date(isoOrNull);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function mapWorkMode(job: FreeHireJob): WorkMode {
  const wm = (job.work_mode ?? "").toLowerCase();
  if (wm === "remote") return "remote";
  if (wm === "hybrid") return "hybrid";
  if (wm === "onsite") return "onsite";

  const loc = (job.location ?? "").toLowerCase();
  if (/\bremote\b/.test(loc)) return "remote";
  if (/\bhybrid\b/.test(loc)) return "hybrid";
  if (/on-?site|in-?office/.test(loc)) return "onsite";
  return "unknown";
}

function mapContractAndHours(job: FreeHireJob): { contract: Contract; hoursText: string } {
  const emp = (job.enrichment?.employment_type ?? "").toLowerCase();
  if (emp === "part_time") return { contract: "part_time", hoursText: "Part-time" };
  if (emp === "full_time") return { contract: "full_time", hoursText: "Full-time" };
  if (emp === "contract") return { contract: "full_time", hoursText: "Contract" };
  if (emp === "internship") return { contract: "full_time", hoursText: "Internship" };
  if (emp === "fellowship") return { contract: "full_time", hoursText: "Fellowship" };
  return { contract: "unknown", hoursText: "" };
}

function formatSalary(enrichment: FreeHireEnrichment | null | undefined): {
  salaryText: string;
  salaryMin: number | null;
  salaryMax: number | null;
} {
  if (!enrichment) return { salaryText: "", salaryMin: null, salaryMax: null };
  const min = enrichment.salary_min ?? null;
  const max = enrichment.salary_max ?? null;
  if (min == null && max == null) return { salaryText: "", salaryMin: null, salaryMax: null };

  const currency = (enrichment.salary_currency ?? "GBP").toUpperCase();
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const period = (enrichment.salary_period ?? "year").toLowerCase();
  const suffix = period === "year" ? "" : ` / ${period}`;

  const fmt = (n: number) => `${sym}${Math.round(n).toLocaleString("en-GB")}`;
  let salaryText = "";
  if (min != null && max != null && min !== max) {
    salaryText = `${fmt(min)} - ${fmt(max)}${suffix}`;
  } else if (min != null) {
    salaryText = `${fmt(min)}${suffix}`;
  } else if (max != null) {
    salaryText = `${fmt(max)}${suffix}`;
  }

  const isAnnual = period === "year" || !enrichment.salary_period;
  return {
    salaryText,
    salaryMin: isAnnual && min != null ? Math.round(min) : null,
    salaryMax: isAnnual && max != null ? Math.round(max) : null,
  };
}

function mapSponsorship(job: FreeHireJob): {
  sponsorship: Sponsorship;
  sponsorshipEvidence: string;
  licensedSponsor: boolean;
} {
  const collections = job.collections ?? [];
  const licensedSponsor = collections.includes("uk-skilled-worker-sponsor");
  const vs = job.enrichment?.visa_sponsorship;

  if (vs === true) {
    return {
      sponsorship: "offered",
      sponsorshipEvidence: "Visa sponsorship offered (FreeHire)",
      licensedSponsor,
    };
  }
  if (vs === false) {
    return {
      sponsorship: "not_offered",
      sponsorshipEvidence: "Visa sponsorship not offered (FreeHire)",
      licensedSponsor,
    };
  }
  return {
    sponsorship: "not_stated",
    sponsorshipEvidence: "",
    licensedSponsor,
  };
}

export function toScrapedJobFromFreeHire(job: FreeHireJob): ScrapedJob {
  const workMode = mapWorkMode(job);
  const { contract, hoursText } = mapContractAndHours(job);
  const { salaryText, salaryMin, salaryMax } = formatSalary(job.enrichment);
  const { sponsorship, sponsorshipEvidence, licensedSponsor } = mapSponsorship(job);

  const locationText =
    job.location?.trim() ||
    (job.cities && job.cities.length > 0 ? job.cities.join(", ") : "") ||
    (workMode === "remote" ? "Remote" : "");

  const url = job.url?.trim() || `https://freehire.me/jobs/${encodeURIComponent(job.public_slug)}`;

  return {
    org: job.company || "Unknown organisation",
    title: job.title,
    locationText,
    url,
    salaryText,
    salaryMin,
    salaryMax,
    postedDate: toIsoDate(job.posted_at ?? job.created_at),
    closingDate: null,
    contract,
    workMode,
    hoursText,
    source: job.source ? `freehire (${job.source})` : "freehire",
    sponsorship,
    sponsorshipEvidence,
    licensedSponsor,
  };
}

/**
 * Derive FreeHire geography parameters (`regions`, `cities`) from Scope locations.
 * In FreeHire, `regions`, `countries`, and `cities` form a single OR group.
 */
export function buildSearchParams(query: ScrapeQuery, keywordsChunk: string[]): URLSearchParams {
  const params = new URLSearchParams();

  const q = keywordsChunk
    .map((k) => k.trim())
    .filter(Boolean)
    .join(" ");
  if (q) {
    params.set("q", q);
  }

  const regions = new Set<string>();
  const cities = new Set<string>();

  for (const rawLoc of query.locations) {
    const loc = rawLoc.trim();
    if (!loc) continue;
    const lower = loc.toLowerCase();

    if (/\b(uk|united kingdom|scotland|england|wales|northern ireland|britain)\b/.test(lower)) {
      regions.add("uk");
    } else if (/\b(eu|europe|european)\b/.test(lower)) {
      regions.add("eu");
    } else if (/\b(global|worldwide|anywhere)\b/.test(lower)) {
      regions.add("global");
    } else if (!/\bremote\b/.test(lower)) {
      // Treat specific place names (e.g., "Edinburgh", "Glasgow", "London") as city filters
      // and include UK region if it's a known UK city so UK-wide remote roles also match.
      cities.add(loc);
      if (/\b(edinburgh|glasgow|london|manchester|bristol|birmingham|leeds|cardiff|belfast|brighton|oxford|cambridge)\b/.test(lower)) {
        regions.add("uk");
      }
    }
  }

  for (const r of regions) {
    params.append("regions", r);
  }
  for (const c of cities) {
    params.append("cities", c);
  }

  params.set("sort", "posted_at");
  params.set("order", "desc");
  params.set("limit", String(PAGE_LIMIT));
  params.set("offset", "0");

  return params;
}

async function fetchFreeHireSearch(baseUrl: string, apiKey: string | undefined, params: URLSearchParams): Promise<FreeHireJob[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const cleanBase = baseUrl.replace(/\/+$/, "");
  const url = `${cleanBase}/jobs/search?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = (await response.json().catch(() => null)) as { error?: string } | null;
      const detail = errBody?.error ? ` (${errBody.error})` : "";
      throw new Error(`FreeHire API ${response.status}: ${response.statusText}${detail}`);
    }

    const body = (await response.json()) as FreeHireSearchResponse;
    return body.data ?? [];
  } finally {
    clearTimeout(timer);
  }
}

export const freehireScraper: Scraper = {
  id: "freehire",
  name: "FreeHire Public API",
  requiresKey: false,

  isConfigured(): boolean {
    return true;
  },

  async scrape(query: ScrapeQuery): Promise<ScraperResult> {
    const started = Date.now();
    try {
      const env = getEnv();
      const baseUrl = env.FREEHIRE_API_URL;
      const apiKey = env.FREEHIRE_API_KEY;

      // Group keywords into compact batches so each FreeHire OR search query stays focused
      const terms = query.keywords.map((k) => k.trim()).filter(Boolean);
      const chunks: string[][] = [];
      const chunkSize = 8;
      for (let i = 0; i < terms.length; i += chunkSize) {
        chunks.push(terms.slice(i, i + chunkSize));
      }
      if (chunks.length === 0) {
        chunks.push([query.sector].filter(Boolean));
      }

      const rawBatches = await Promise.all(
        chunks.map((chunk) => {
          const params = buildSearchParams(query, chunk);
          return fetchFreeHireSearch(baseUrl, apiKey, params);
        }),
      );
      const rawJobs = rawBatches.flat();

      const seenSlugs = new Set<string>();
      const uniqueJobs: ScrapedJob[] = [];

      for (const item of rawJobs) {
        if (item.closed_at) continue;
        const key = item.public_slug || item.url || `${item.company}:${item.title}`;
        if (seenSlugs.has(key)) continue;
        seenSlugs.add(key);
        uniqueJobs.push(toScrapedJobFromFreeHire(item));
      }

      log.info(
        "freehire",
        `fetched ${rawJobs.length} postings (${uniqueJobs.length} unique open) from FreeHire API in ${Date.now() - started}ms`,
      );

      return {
        scraperId: "freehire",
        scraperName: "FreeHire Public API",
        jobs: uniqueJobs,
        durationMs: Date.now() - started,
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      log.error("freehire", `FreeHire API request failed: ${msg}`, err);
      return {
        scraperId: "freehire",
        scraperName: "FreeHire Public API",
        jobs: [],
        durationMs: Date.now() - started,
        error: msg,
      };
    }
  },
};

