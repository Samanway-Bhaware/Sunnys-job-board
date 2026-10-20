/**
 * Guardian Jobs (Media, Marketing & PR) Web Scraper.
 *
 * Dedicated UK job board for media, journalism, communications, PR, marketing,
 * publishing, arts, and creative charities.
 *
 * Public feeds:
 *   - https://jobs.theguardian.com/jobs/media/rss/
 *   - https://jobs.theguardian.com/jobs/marketing-pr-and-advertising/rss/
 */

import { log } from "@/lib/log";
import type { Contract, WorkMode } from "@/lib/jobs/types";
import type { ScrapedJob, Scraper, ScrapeQuery, ScraperResult } from "./types";

const TIMEOUT_MS = 10_000;
const FEEDS = [
  "https://jobs.theguardian.com/jobs/media/rss/",
  "https://jobs.theguardian.com/jobs/marketing-pr-and-advertising/rss/",
];

interface GuardianRssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

function parseGuardianRss(xml: string): GuardianRssItem[] {
  const items: GuardianRssItem[] = [];
  const matches = xml.matchAll(/<item[\s\S]*?<\/item>/gi);

  for (const match of matches) {
    const raw = match[0];
    const getField = (tag: string): string => {
      const tagMatch = raw.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
      return tagMatch ? tagMatch[1]!.trim() : "";
    };

    const title = getField("title");
    const link = getField("link");
    const description = getField("description").replace(/<[^>]+>/g, " ");
    const pubDate = getField("pubDate");

    if (title && link) {
      items.push({ title, link, description, pubDate });
    }
  }

  return items;
}

function parsePubDate(pubDateStr: string): string | null {
  if (!pubDateStr) return null;
  try {
    const d = new Date(pubDateStr);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  } catch {
    return null;
  }
}

function parseTitleAndOrg(titleStr: string): { org: string; title: string } {
  // Guardian titles are usually "Job Title - Organisation Name" or "Job Title at Organisation"
  const atMatch = titleStr.match(/^(.*?)\s+(?:at|@)\s+(.*)$/i);
  const dashMatch = titleStr.match(/^(.*?)\s+[-–—|]\s+(.*)$/);

  if (atMatch) {
    return { title: atMatch[1]!.trim(), org: atMatch[2]!.trim() };
  }
  if (dashMatch) {
    return { title: dashMatch[1]!.trim(), org: dashMatch[2]!.trim() };
  }
  return { title: titleStr.trim(), org: "Guardian Jobs Employer" };
}

function detectWorkMode(text: string): WorkMode {
  const lower = text.toLowerCase();
  if (/\bremote\b|\bwork from home\b|\bwfh\b/.test(lower)) return "remote";
  if (/\bhybrid\b/.test(lower)) return "hybrid";
  if (/\bon-?site\b|\bin-?office\b/.test(lower)) return "onsite";
  return "unknown";
}

function detectContract(text: string): { contract: Contract; hoursText: string } {
  const lower = text.toLowerCase();
  if (/\bpart-?time\b/.test(lower)) return { contract: "part_time", hoursText: "Part-time" };
  if (/\bfull-?time\b/.test(lower)) return { contract: "full_time", hoursText: "Full-time" };
  if (/\bcontract\b|\bfreelance\b/.test(lower)) return { contract: "full_time", hoursText: "Contract" };
  return { contract: "unknown", hoursText: "" };
}

function parseSalary(text: string): { salaryText: string; salaryMin: number | null; salaryMax: number | null } {
  const match = text.match(/£\s*(\d[\d,]*)\s*(?:[-–to]\s*£?\s*(\d[\d,]*))?/i);
  if (!match) return { salaryText: "", salaryMin: null, salaryMax: null };

  const min = parseInt(match[1]!.replace(/,/g, ""), 10);
  const max = match[2] ? parseInt(match[2].replace(/,/g, ""), 10) : null;

  return {
    salaryText: match[0].trim(),
    salaryMin: isNaN(min) ? null : min,
    salaryMax: max && !isNaN(max) ? max : null,
  };
}

async function fetchFeed(url: string, signal: AbortSignal): Promise<GuardianRssItem[]> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; sunnynunny-jobboard/1.0)",
        Accept: "application/rss+xml, application/xml, text/xml",
      },
      signal,
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseGuardianRss(xml);
  } catch {
    return [];
  }
}

export const guardianJobsScraper: Scraper = {
  id: "guardian",
  name: "Guardian Jobs (Web)",
  requiresKey: false,

  isConfigured(): boolean {
    return true;
  },

  async scrape(query: ScrapeQuery): Promise<ScraperResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      log.info("guardian", "Fetching Guardian Jobs media & PR feeds");
      const feeds = await Promise.all(FEEDS.map((url) => fetchFeed(url, controller.signal)));
      const allItems = feeds.flat();

      const terms = query.keywords.map((k) => k.toLowerCase().trim()).filter(Boolean);
      const jobs: ScrapedJob[] = [];
      const seen = new Set<string>();

      for (const item of allItems) {
        const fullContent = `${item.title} ${item.description}`.toLowerCase();
        const matchesKeyword = terms.some((term) => fullContent.includes(term));
        if (!matchesKeyword && terms.length > 0) continue;

        if (seen.has(item.link)) continue;
        seen.add(item.link);

        const { org, title } = parseTitleAndOrg(item.title);
        const { contract, hoursText } = detectContract(item.description);
        const workMode = detectWorkMode(fullContent);
        const { salaryText, salaryMin, salaryMax } = parseSalary(item.description);

        jobs.push({
          org,
          title,
          locationText: "",
          url: item.link,
          salaryText,
          salaryMin,
          salaryMax,
          postedDate: parsePubDate(item.pubDate),
          closingDate: null,
          contract,
          workMode,
          hoursText,
          source: "guardian",
        });
      }

      log.info("guardian", `Found ${jobs.length} listings from Guardian Jobs in ${Date.now() - started}ms`);

      return {
        scraperId: "guardian",
        scraperName: "Guardian Jobs (Web)",
        jobs,
        durationMs: Date.now() - started,
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Guardian Jobs request failed";
      log.warn("guardian", `${msg} (${String(err)})`);
      return {
        scraperId: "guardian",
        scraperName: "Guardian Jobs (Web)",
        jobs: [],
        durationMs: Date.now() - started,
        error: msg,
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
