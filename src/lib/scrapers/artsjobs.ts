/**
 * Arts Jobs (Arts Council England) Web Scraper.
 *
 * Dedicated to the UK creative & cultural industries:
 * arts, festivals, museums, theatre, music, film, publishing, design, media, and creative charities.
 *
 * Feed: https://www.artsjobs.org.uk/feed/
 * Keyless public RSS feed.
 */

import { log } from "@/lib/log";
import type { Contract, WorkMode } from "@/lib/jobs/types";
import type { ScrapedJob, Scraper, ScrapeQuery, ScraperResult } from "./types";

const TIMEOUT_MS = 10_000;
const FEED_URL = "https://www.artsjobs.org.uk/feed/";

interface FeedItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  creator?: string;
}

function parseRssXml(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const itemMatches = xml.matchAll(/<item[\s\S]*?<\/item>/gi);

  for (const match of itemMatches) {
    const raw = match[0];

    const getField = (tag: string): string => {
      const tagMatch = raw.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i"));
      return tagMatch ? tagMatch[1]!.trim() : "";
    };

    const title = getField("title");
    const link = getField("link");
    const description = getField("description").replace(/<[^>]+>/g, " ");
    const pubDate = getField("pubDate");
    const creator = getField("dc:creator");

    if (title && link) {
      items.push({ title, link, description, pubDate, creator });
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

function extractOrgAndTitle(titleStr: string, creator?: string): { org: string; title: string } {
  // Common ArtsJobs title formats:
  // "Marketing Assistant at National Theatre"
  // "Communications Officer - London Symphony Orchestra"
  // "PR Manager | Tate"
  let org = creator || "";
  let title = titleStr;

  const atMatch = titleStr.match(/^(.*?)\s+(?:at|@)\s+(.*)$/i);
  const dashMatch = titleStr.match(/^(.*?)\s+[-–—|]\s+(.*)$/);

  if (atMatch) {
    title = atMatch[1]!.trim();
    org = atMatch[2]!.trim();
  } else if (dashMatch) {
    title = dashMatch[1]!.trim();
    org = dashMatch[2]!.trim();
  }

  if (!org) org = "Arts & Cultural Employer";
  return { org, title };
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

export const artsJobsScraper: Scraper = {
  id: "artsjobs",
  name: "Arts Jobs UK (Web)",
  requiresKey: false,

  isConfigured(): boolean {
    return true;
  },

  async scrape(query: ScrapeQuery): Promise<ScraperResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      log.info("artsjobs", "Fetching latest creative roles from Arts Jobs RSS");
      const response = await fetch(FEED_URL, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; sunnynunny-jobboard/1.0)",
          Accept: "application/rss+xml, application/xml, text/xml",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Arts Jobs responded with ${response.status}: ${response.statusText}`);
      }

      const xml = await response.text();
      const items = parseRssXml(xml);

      const terms = query.keywords.map((k) => k.toLowerCase().trim()).filter(Boolean);
      const jobs: ScrapedJob[] = [];
      const seen = new Set<string>();

      for (const item of items) {
        const fullContent = `${item.title} ${item.description}`.toLowerCase();

        // Check if item matches any role keywords or broad sector
        const matchesKeyword = terms.some((term) => fullContent.includes(term));
        if (!matchesKeyword && terms.length > 0) continue;

        if (seen.has(item.link)) continue;
        seen.add(item.link);

        const { org, title } = extractOrgAndTitle(item.title, item.creator);
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
          source: "artsjobs",
        });
      }

      log.info("artsjobs", `Found ${jobs.length} relevant creative listings from Arts Jobs in ${Date.now() - started}ms`);

      return {
        scraperId: "artsjobs",
        scraperName: "Arts Jobs UK (Web)",
        jobs,
        durationMs: Date.now() - started,
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Arts Jobs request failed";
      log.warn("artsjobs", `${msg} (${String(err)})`);
      return {
        scraperId: "artsjobs",
        scraperName: "Arts Jobs UK (Web)",
        jobs: [],
        durationMs: Date.now() - started,
        error: msg,
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
