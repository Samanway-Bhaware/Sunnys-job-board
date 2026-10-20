import { afterEach, describe, expect, it, vi } from "vitest";
import { ALL_SCRAPERS, configuredScrapers, scrapeAll } from "@/lib/scrapers";
import { buildSearchParams, toScrapedJobFromFreeHire, type FreeHireJob } from "@/lib/scrapers/freehire";

describe("FreeHire public API integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers the keyless FreeHire public API provider exclusively", () => {
    const ids = ALL_SCRAPERS.map((s) => s.id);
    expect(ids).toEqual(["freehire"]);

    const configured = configuredScrapers();
    expect(configured.map((s) => s.id)).toEqual(["freehire"]);
    expect(configured[0]!.requiresKey).toBe(false);
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

  it("fetches from FreeHire /jobs/search and normalises listings end-to-end", async () => {
    const prevMock = process.env.USE_MOCK_PROVIDER;
    delete process.env.USE_MOCK_PROVIDER;

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
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
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    try {
      const res = await scrapeAll({
        keywords: ["Communications"],
        locations: ["Remote (UK)"],
        sector: "Arts",
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const calledUrl = String(fetchSpy.mock.calls[0]![0]);
      expect(calledUrl).toContain("https://freehire.me/api/v1/jobs/search?");
      expect(calledUrl).toContain("q=Communications");
      expect(res.listings).toHaveLength(1);
      expect(res.listings[0]).toMatchObject({
        org: "Scottish Arts Trust",
        title: "Communications Lead",
        workMode: "remote",
        contract: "full_time",
        sponsorship: "not_offered",
        salaryMin: 40000,
        salaryMax: 45000,
      });
    } finally {
      if (prevMock !== undefined) process.env.USE_MOCK_PROVIDER = prevMock;
    }
  });
});
