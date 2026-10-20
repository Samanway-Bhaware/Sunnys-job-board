/**
 * Reed.co.uk Jobseeker API client.
 *
 * Docs: https://www.reed.co.uk/developers/jobseeker
 * Endpoint: GET https://www.reed.co.uk/api/1.0/search
 * Auth: HTTP Basic Auth with API key as username, empty password.
 */

import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";
import type { Contract, WorkMode } from "@/lib/jobs/types";
import type { ScrapedJob, Scraper, ScrapeQuery, ScraperResult } from "./types";

const TIMEOUT_MS = 10_000;

interface ReedJob {
  jobId: number;
  employerId?: number;
  employerName?: string;
  jobTitle: string;
  locationName?: string;
  minimumSalary?: number | null;
  maximumSalary?: number | null;
  yearlyMinimumSalary?: number | null;
  yearlyMaximumSalary?: number | null;
  currency?: string;
  salaryType?: string;
  salary?: string;
  date?: string;
  expirationDate?: string;
  partTime?: boolean;
  fullTime?: boolean;
  contractType?: string;
  jobDescription?: string;
  jobUrl: string;
}

interface ReedSearchResponse {
  results?: ReedJob[];
  totalResults?: number;
}

function parseReedDate(dateStr?: string): string | null {
  if (!dateStr) return null;
  try {
    // Reed often formats dates as DD/MM/YYYY or ISO
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
      const [day, month, year] = dateStr.split("/");
      return `${year}-${month}-${day}`;
    }
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  } catch {
    return null;
  }
}

function detectWorkMode(title: string, location: string, desc: string): WorkMode {
  const combined = `${title} ${location} ${desc}`.toLowerCase();
  if (/\bremote\b|\bwork from home\b|\bwfh\b/.test(combined)) return "remote";
  if (/\bhybrid\b/.test(combined)) return "hybrid";
  if (/\bon-?site\b|\bin-?office\b/.test(combined)) return "onsite";
  return "unknown";
}

function detectContract(job: ReedJob): { contract: Contract; hoursText: string } {
  if (job.partTime) return { contract: "part_time", hoursText: "Part-time" };
  if (job.fullTime) return { contract: "full_time", hoursText: "Full-time" };
  const desc = `${job.jobTitle} ${job.contractType ?? ""} ${job.jobDescription ?? ""}`.toLowerCase();
  if (/\bpart-?time\b/.test(desc)) return { contract: "part_time", hoursText: "Part-time" };
  if (/\bfull-?time\b/.test(desc)) return { contract: "full_time", hoursText: "Full-time" };
  return { contract: "unknown", hoursText: "" };
}

function toScrapedJobFromReed(job: ReedJob): ScrapedJob {
  const { contract, hoursText } = detectContract(job);
  const location = (job.locationName ?? "").trim();
  const title = (job.jobTitle ?? "").trim();
  const desc = job.jobDescription ?? "";
  const workMode = detectWorkMode(title, location, desc);

  const minSalary = job.yearlyMinimumSalary ?? job.minimumSalary ?? null;
  const maxSalary = job.yearlyMaximumSalary ?? job.maximumSalary ?? null;

  let salaryText = (job.salary ?? "").trim();
  if (!salaryText && (minSalary != null || maxSalary != null)) {
    if (minSalary != null && maxSalary != null && minSalary !== maxSalary) {
      salaryText = `£${Math.round(minSalary).toLocaleString("en-GB")} - £${Math.round(maxSalary).toLocaleString("en-GB")}`;
    } else if (minSalary != null) {
      salaryText = `£${Math.round(minSalary).toLocaleString("en-GB")}`;
    } else if (maxSalary != null) {
      salaryText = `£${Math.round(maxSalary).toLocaleString("en-GB")}`;
    }
  }

  return {
    org: (job.employerName ?? "Unknown").trim(),
    title,
    locationText: location,
    url: job.jobUrl,
    salaryText,
    salaryMin: minSalary ? Math.round(minSalary) : null,
    salaryMax: maxSalary ? Math.round(maxSalary) : null,
    postedDate: parseReedDate(job.date),
    closingDate: parseReedDate(job.expirationDate),
    contract,
    workMode,
    hoursText,
    source: "reed",
  };
}

async function fetchReedJobs(apiKey: string, keywords: string, location?: string): Promise<ReedJob[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const params = new URLSearchParams();
  if (keywords) params.set("keywords", keywords);
  if (location && !/\bremote\b/i.test(location)) {
    params.set("locationName", location);
    params.set("distanceFromLocation", "25");
  }
  params.set("resultsToTake", "50");

  const authHeader = `Basic ${Buffer.from(`${apiKey.trim()}:`).toString("base64")}`;
  const url = `https://www.reed.co.uk/api/1.0/search?${params.toString()}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Reed API responded with ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as ReedSearchResponse;
    return data.results ?? [];
  } finally {
    clearTimeout(timer);
  }
}

export const reedScraper: Scraper = {
  id: "reed",
  name: "Reed Jobs API",
  requiresKey: true,

  isConfigured(): boolean {
    const env = getEnv();
    return Boolean(env.REED_API_KEY && env.REED_API_KEY.trim().length > 0);
  },

  async scrape(query: ScrapeQuery): Promise<ScraperResult> {
    const started = Date.now();
    const env = getEnv();
    const apiKey = env.REED_API_KEY;

    if (!apiKey) {
      return {
        scraperId: "reed",
        scraperName: "Reed Jobs API",
        jobs: [],
        durationMs: 0,
        error: null,
      };
    }

    try {
      log.info("reed", `Querying Reed API for keywords: ${query.keywords.slice(0, 5).join(", ")}`);

      // Query primary role keyword phrases in parallel
      const searchTerms = query.keywords.slice(0, 4);
      const locations = query.locations.slice(0, 2);
      const loc = locations[0] ?? "";

      const rawBatches = await Promise.all(
        searchTerms.map((term) =>
          fetchReedJobs(apiKey, `${query.sector} ${term}`.trim(), loc).catch((err) => {
            log.warn("reed", `Search failed for term "${term}": ${err instanceof Error ? err.message : err}`);
            return [] as ReedJob[];
          }),
        ),
      );

      const allJobs: ScrapedJob[] = [];
      const seenUrls = new Set<string>();

      for (const batch of rawBatches) {
        for (const raw of batch) {
          if (!raw.jobUrl || seenUrls.has(raw.jobUrl)) continue;
          seenUrls.add(raw.jobUrl);
          allJobs.push(toScrapedJobFromReed(raw));
        }
      }

      log.info("reed", `Fetched ${allJobs.length} listings from Reed in ${Date.now() - started}ms`);

      return {
        scraperId: "reed",
        scraperName: "Reed Jobs API",
        jobs: allJobs,
        durationMs: Date.now() - started,
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Reed search failed";
      log.error("reed", msg, err);
      return {
        scraperId: "reed",
        scraperName: "Reed Jobs API",
        jobs: [],
        durationMs: Date.now() - started,
        error: msg,
      };
    }
  },
};
