/**
 * Shared types for all job board scrapers.
 *
 * Each scraper produces `ScrapedJob[]`. The orchestrator converts them to
 * `NormalisedListing[]` and feeds them into the existing merge pipeline.
 */

import type { Contract, Sponsorship, WorkMode } from "@/lib/jobs/types";

export interface ScrapedJob {
  /** Organisation / employer name. */
  org: string;
  /** Job title. */
  title: string;
  /** Free-text location string. */
  locationText: string;
  /** Direct link to the listing. */
  url: string;
  /** Free-text salary string, e.g. "£30,000 - £40,000". */
  salaryText: string;
  /** Parsed minimum salary in GBP/year, or null. */
  salaryMin: number | null;
  /** Parsed maximum salary in GBP/year, or null. */
  salaryMax: number | null;
  /** YYYY-MM-DD or null. */
  postedDate: string | null;
  /** YYYY-MM-DD or null. */
  closingDate: string | null;
  contract: Contract;
  workMode: WorkMode;
  hoursText: string;
  /** Which source this came from, e.g. "freehire" or upstream ATS name. */
  source: string;
  /** Optional visa sponsorship status provided by FreeHire enrichment. */
  sponsorship?: Sponsorship;
  /** Optional evidence string for visa sponsorship. */
  sponsorshipEvidence?: string;
  /** Optional flag if FreeHire marks the company in uk-skilled-worker-sponsor collection. */
  licensedSponsor?: boolean;
}

export interface ScrapeQuery {
  /** Role-specific search terms, e.g. ["PR", "communications", "content"]. */
  keywords: string[];
  /** Preferred locations, e.g. ["Edinburgh", "Remote"]. */
  locations: string[];
  /** The sector/industry, e.g. "Creative industries". */
  sector: string;
}

export interface ScraperResult {
  scraperId: string;
  scraperName: string;
  jobs: ScrapedJob[];
  durationMs: number;
  error: string | null;
}

export interface Scraper {
  id: string;
  name: string;
  /** True if the scraper needs an API key configured in .env. */
  requiresKey: boolean;
  /** Whether this scraper has its required key(s) set. */
  isConfigured(): boolean;
  /** Run the scrape. Should never throw — return error in result instead. */
  scrape(query: ScrapeQuery): Promise<ScraperResult>;
}
