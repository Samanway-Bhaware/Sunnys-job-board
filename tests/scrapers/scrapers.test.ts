import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_SCRAPERS, configuredScrapers, scrapeAll } from "@/lib/scrapers";
import { buildSearchParams, toScrapedJobFromFreeHire, type FreeHireJob } from "@/lib/scrapers/freehire";
import { reedScraper } from "@/lib/scrapers/reed";
import { artsJobsScraper } from "@/lib/scrapers/artsjobs";
import { guardianJobsScraper } from "@/lib/scrapers/guardian";

describe("Multi-source scraper integration (FreeHire + Web scrapers)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers FreeHire and web scrapers in ALL_SCRAPERS", () => {
    const ids = ALL_SCRAPERS.map((s) => s.id);
    expect(ids).toEqual(["freehire", "reed", "artsjobs", "guardian"]);

    const configured = configuredScrapers();
    const configuredIds = configured.map((s) => s.id);
    expect(configuredIds).toContain("freehire");
    expect(configuredIds).toContain("artsjobs");
    expect(configuredIds).toContain("guardian");

    const freehire = ALL_SCRAPERS.find((s) => s.id === "freehire");
    expect(freehire?.requiresKey).toBe(false);

    const artsjobs = ALL_SCRAPERS.find((s) => s.id === "artsjobs");
    expect(artsjobs?.requiresKey).toBe(false);

    const guardian = ALL_SCRAPERS.find((s) => s.id === "guardian");
    expect(guardian?.requiresKey).toBe(false);

    const reed = ALL_SCRAPERS.find((s) => s.id === "reed");
    expect(reed?.requiresKey).toBe(true);
  });

  it("maps FreeHire jobview wire shape and enrichment fields to ScrapedJob", () => {
    const raw: FreeHireJob = {
      public_slug: "marketing-manager-royal-mile-1a2b",
      source: "greenhouse",
      url: "https://boards.greenhouse.io/royalmile/jobs/123",
      title: "Marketing Manager",
      company: "Royal Mile Playhouse",
      location: "Edinburgh, UK",
      work_mode: "hybrid",
      collections: ["uk-skilled-worker-sponsor"],
      posted_at: "2026-09-15T10:00:00Z",
      closed_at: null,
      enrichment: {
        employment_type: "part_time",
        visa_sponsorship: true,
        salary_min: 32000,
        salary_max: 36000,
        salary_currency: "GBP",
        salary_period: "year",
      },
    };

    const mapped = toScrapedJobFromFreeHire(raw);
    expect(mapped).toMatchObject({
      org: "Royal Mile Playhouse",
      title: "Marketing Manager",
      locationText: "Edinburgh, UK",
      url: "https://boards.greenhouse.io/royalmile/jobs/123",
      salaryText: "£32,000 - £36,000",
      salaryMin: 32000,
      salaryMax: 36000,
      postedDate: "2026-09-15",
      contract: "part_time",
      workMode: "hybrid",
      hoursText: "Part-time",
      source: "freehire (greenhouse)",
      sponsorship: "offered",
      licensedSponsor: true,
    });
  });

  it("builds FreeHire /api/v1/jobs/search query parameters with geography OR groups", () => {
    const params = buildSearchParams(
      {
        keywords: ["Communications", "PR"],
        locations: ["Remote (UK)", "Edinburgh"],
        sector: "Creative industries",
      },
      ["Communications", "PR"],
    );

    expect(params.get("q")).toBe("Communications PR");
    expect(params.getAll("regions")).toContain("uk");
    expect(params.getAll("cities")).toContain("Edinburgh");
    expect(params.get("sort")).toBe("posted_at");
    expect(params.get("order")).toBe("desc");
    expect(params.get("limit")).toBe("100");
  });

  it("parses Arts Jobs RSS feed xml correctly", async () => {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel>
        <item>
          <title><![CDATA[Communications Officer — Tate Modern]]></title>
          <link>https://www.artsjobs.org.uk/arts-job/communications-officer-tate</link>
          <description><![CDATA[We are seeking a full-time Communications Officer with a salary of £30,000 - £34,000. Hybrid role.]]></description>
          <pubDate>Tue, 14 Oct 2026 10:00:00 +0000</pubDate>
          <dc:creator>Tate Modern</dc:creator>
        </item>
      </channel>
    </rss>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(sampleXml, { status: 200, headers: { "Content-Type": "application/xml" } }),
    );

    const result = await artsJobsScraper.scrape({
      keywords: ["Communications"],
      locations: ["London"],
      sector: "Arts",
    });

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({
      org: "Tate Modern",
      title: "Communications Officer",
      url: "https://www.artsjobs.org.uk/arts-job/communications-officer-tate",
      contract: "full_time",
      workMode: "hybrid",
      source: "artsjobs",
      salaryMin: 30000,
      salaryMax: 34000,
    });
  });

  it("parses Guardian Jobs RSS feed xml correctly", async () => {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <item>
          <title><![CDATA[Senior Marketing Manager at National Theatre]]></title>
          <link>https://jobs.theguardian.com/job/12345/senior-marketing-manager/</link>
          <description><![CDATA[London | £45,000 - £50,000 | Remote | Lead marketing campaigns for our upcoming season.]]></description>
          <pubDate>Wed, 15 Oct 2026 12:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(sampleXml, { status: 200, headers: { "Content-Type": "application/xml" } }),
    );

    const result = await guardianJobsScraper.scrape({
      keywords: ["Marketing"],
      locations: ["London"],
      sector: "Theatre",
    });

    expect(result.jobs.length).toBeGreaterThan(0);
    expect(result.jobs[0]).toMatchObject({
      org: "National Theatre",
      title: "Senior Marketing Manager",
      url: "https://jobs.theguardian.com/job/12345/senior-marketing-manager/",
      source: "guardian",
      workMode: "remote",
      salaryMin: 45000,
      salaryMax: 50000,
    });
  });

  it("parses Reed API job responses correctly", async () => {
    const sampleReedResponse = JSON.stringify({
      results: [
        {
          jobId: 999,
          employerName: "Edinburgh Comms Agency",
          jobTitle: "PR & Communications Officer",
          locationName: "Edinburgh",
          minimumSalary: 35000,
          maximumSalary: 40000,
          fullTime: true,
          jobUrl: "https://www.reed.co.uk/jobs/pr-communications-officer/999",
          date: "18/10/2026",
        },
      ],
      totalResults: 1,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(sampleReedResponse, { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const result = await reedScraper.scrape({
      keywords: ["Communications"],
      locations: ["Edinburgh"],
      sector: "Media",
    });

    expect(result.scraperId).toBe("reed");
    if (reedScraper.isConfigured()) {
      expect(result.jobs.length).toBeGreaterThan(0);
      expect(result.jobs[0]).toMatchObject({
        org: "Edinburgh Comms Agency",
        title: "PR & Communications Officer",
        salaryMin: 35000,
        salaryMax: 40000,
        source: "reed",
      });
    }
  });

  it("aggregates listings across FreeHire and web scrapers end-to-end", async () => {
    const prevMock = process.env.USE_MOCK_PROVIDER;
    delete process.env.USE_MOCK_PROVIDER;

    const freehireJson = JSON.stringify({
      data: [
        {
          public_slug: "comms-lead-arts-trust-9f8e",
          source: "lever",
          url: "https://jobs.lever.co/artstrust/9f8e",
          title: "Communications Lead",
          company: "Scottish Arts Trust",
          location: "Remote — UK",
          work_mode: "remote",
          posted_at: "2026-10-01T00:00:00Z",
          closed_at: null,
          enrichment: {
            employment_type: "full_time",
            visa_sponsorship: false,
            salary_min: 40000,
            salary_max: 45000,
            salary_currency: "GBP",
            salary_period: "year",
          },
        },
      ],
      meta: { total: 1, limit: 100, offset: 0 },
    });

    const artsJobsXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel>
        <item>
          <title><![CDATA[Communications Officer — Design Museum]]></title>
          <link>https://www.artsjobs.org.uk/arts-job/comms-design-museum</link>
          <description><![CDATA[Full time communications officer. Salary £32,000.]]></description>
          <pubDate>Thu, 16 Oct 2026 09:00:00 GMT</pubDate>
          <dc:creator>Design Museum</dc:creator>
        </item>
      </channel>
    </rss>`;

    const guardianXml = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0">
      <channel>
        <item>
          <title><![CDATA[Communications Assistant at British Council]]></title>
          <link>https://jobs.theguardian.com/job/9876/comms-asst/</link>
          <description><![CDATA[London | £28,000 | Communications team]]></description>
          <pubDate>Fri, 17 Oct 2026 11:00:00 GMT</pubDate>
        </item>
      </channel>
    </rss>`;

    const reedJson = JSON.stringify({
      results: [
        {
          jobId: 111,
          employerName: "Edinburgh Comms Agency",
          jobTitle: "Communications Consultant",
          locationName: "Edinburgh",
          minimumSalary: 35000,
          maximumSalary: 40000,
          fullTime: true,
          jobUrl: "https://www.reed.co.uk/jobs/communications-consultant/111",
          date: "18/10/2026",
        },
      ],
      totalResults: 1,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (info) => {
      const url = String(info);
      if (url.includes("freehire.me")) {
        return new Response(freehireJson, { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("reed.co.uk")) {
        return new Response(reedJson, { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("artsjobs.org.uk")) {
        return new Response(artsJobsXml, { status: 200, headers: { "Content-Type": "application/xml" } });
      }
      if (url.includes("theguardian.com")) {
        return new Response(guardianXml, { status: 200, headers: { "Content-Type": "application/xml" } });
      }
      return new Response("", { status: 404 });
    });

    try {
      const res = await scrapeAll({
        keywords: ["Communications"],
        locations: ["Remote (UK)"],
        sector: "Arts",
      });

      expect(fetchSpy).toHaveBeenCalled();
      expect(res.listings.length).toBeGreaterThanOrEqual(3);

      const sources = res.listings.map((l) => l.source);
      // Verify we have listings from FreeHire, Arts Jobs, Guardian (and Reed if configured)
      expect(sources.some((s) => s.includes("freehire"))).toBe(true);
      expect(sources.some((s) => s.includes("artsjobs"))).toBe(true);
      expect(sources.some((s) => s.includes("theguardian.com") || s.includes("guardian"))).toBe(true);
    } finally {
      if (prevMock !== undefined) process.env.USE_MOCK_PROVIDER = prevMock;
    }
  });
});
