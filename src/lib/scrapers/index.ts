/**
 * FreeHire API orchestrator.
 *
 * Queries the FreeHire public API (https://freehire.me/api/v1), converts results
 * to NormalisedListing[], and feeds them through the merge + sponsor-match pipeline.
 */

import { normaliseLocation } from "@/lib/jobs/location";
import type { NormalisedListing } from "@/lib/jobs/types";
import { canonicalUrl, hostnameOf } from "@/lib/search/url";
import { log } from "@/lib/log";

import type { ScrapedJob, Scraper, ScrapeQuery, ScraperResult } from "./types";
import { freehireScraper } from "./freehire";

export const ALL_SCRAPERS: Scraper[] = [freehireScraper];

export function configuredScrapers(): Scraper[] {
  return ALL_SCRAPERS.filter((s) => s.isConfigured());
}

export interface ScrapeAllResult {
  results: ScraperResult[];
  listings: NormalisedListing[];
  totalDurationMs: number;
}

/** Convert a FreeHire job to a NormalisedListing for the merge pipeline. */
export function toNormalisedListing(job: ScrapedJob): NormalisedListing | null {
  const canonical = canonicalUrl(job.url);
  if (!canonical) return null;

  return {
    org: job.org.slice(0, 160),
    title: job.title.slice(0, 200),
    locationText: job.locationText.slice(0, 160),
    locationNorm: normaliseLocation(job.locationText, job.workMode),
    workMode: job.workMode,
    contract: job.contract,
    hoursText: job.hoursText,
    salaryText: job.salaryText,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    sponsorship: job.sponsorship ?? "not_stated",
    sponsorshipEvidence: job.sponsorshipEvidence ?? "",
    licensedSponsor: job.licensedSponsor,
    postedDate: job.postedDate,
    closingDate: job.closingDate,
    url: job.url,
    canonicalUrl: canonical,
    source: job.source || hostnameOf(canonical),
    cited: false,
    linkStatus: "unchecked",
  };
}

const FIXTURE_LISTINGS: NormalisedListing[] = [
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
    url: "https://example.com/creative-fund-1",
    canonicalUrl: "https://example.com/creative-fund-1",
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
    sponsorship: "offered",
    sponsorshipEvidence: "Visa sponsorship offered (FreeHire)",
    postedDate: "2026-09-02",
    closingDate: "2026-10-30",
    url: "https://example.com/royal-mile-2",
    canonicalUrl: "https://example.com/royal-mile-2",
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
    sponsorship: "not_offered",
    sponsorshipEvidence: "Visa sponsorship not offered (FreeHire)",
    postedDate: "2026-09-03",
    closingDate: "2026-10-30",
    url: "https://example.com/scottish-books-3",
    canonicalUrl: "https://example.com/scottish-books-3",
    source: "freehire",
    cited: false,
    linkStatus: "verified",
  },
  {
    org: "Harbour Gallery",
    title: "Gallery Assistant",
    locationText: "Edinburgh",
    locationNorm: "Edinburgh",
    workMode: "hybrid",
    contract: "unknown",
    hoursText: "flexible",
    salaryText: "Competitive",
    salaryMin: null,
    salaryMax: null,
    sponsorship: "not_stated",
    sponsorshipEvidence: "",
    postedDate: "2026-09-04",
    closingDate: null,
    url: "https://example.com/harbour-4",
    canonicalUrl: "https://example.com/harbour-4",
    source: "freehire",
    cited: false,
    linkStatus: "verified",
  },
];

export async function scrapeAll(query: ScrapeQuery): Promise<ScrapeAllResult> {
  const started = Date.now();

  // Test mode: return mock fixtures immediately
  if (process.env.USE_MOCK_PROVIDER === "1") {
    return {
      results: [{ scraperId: "freehire", scraperName: "FreeHire Public API", jobs: [], durationMs: 1, error: null }],
      listings: FIXTURE_LISTINGS,
      totalDurationMs: 1,
    };
  }

  const scrapers = configuredScrapers();

  log.info("freehire", `starting FreeHire public API search (${scrapers.map((s) => s.id).join(", ")})`);

  const results = await Promise.all(scrapers.map((s) => s.scrape(query)));

  const allListings: NormalisedListing[] = [];
  const seenUrls = new Set<string>();

  for (const result of results) {
    for (const job of result.jobs) {
      const listing = toNormalisedListing(job);
      if (!listing) continue;

      if (seenUrls.has(listing.canonicalUrl)) continue;
      seenUrls.add(listing.canonicalUrl);
      allListings.push(listing);
    }
  }

  const totalDurationMs = Date.now() - started;
  const totalJobs = results.reduce((sum, r) => sum + r.jobs.length, 0);
  log.info(
    "freehire",
    `finished in ${totalDurationMs}ms: ${totalJobs} raw jobs → ${allListings.length} unique listings`,
  );

  return { results, listings: allListings, totalDurationMs };
}

/** Estimated time for a full FreeHire API fetch, in seconds. */
export function estimatedScrapeTime(): number {
  return 5;
}
