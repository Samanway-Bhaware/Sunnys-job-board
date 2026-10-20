import { beforeEach, describe, expect, it } from "vitest";
import { GET as exportCsv } from "@/app/api/export.csv/route";
import { GET as getJobs } from "@/app/api/jobs/route";
import { getDb } from "@/lib/db";
import { sponsorRegister } from "@/lib/db/schema";
import { mergeListings } from "@/lib/jobs/merge";
import { listJobs, updateJobTracking } from "@/lib/jobs/queries";
import { createRole } from "@/lib/roles";
import { csvCell, parseCsv } from "@/lib/sponsor/csv";
import {
  REGISTER_PAGE_URL,
  downloadRegister,
  findCsvUrl,
  matchSponsor,
  parseRegister,
  registerIsStale,
  registerStatus,
  rematchAllJobs,
  storeRegister,
  type FetchLike,
} from "@/lib/sponsor/register";
import { authed, listing, params, resetTables } from "../helpers";

const PAGE_HTML = `<html><body>
<a class="govuk-link" href="https://assets.publishing.service.gov.uk/media/6aa2617592e72b8ac437f049/SP_-_Worker_and_Temporary_Worker_Web_Register_-_2026-09-10.csv">Download CSV</a>
</body></html>`;

/** Mirrors the real file: leading spaces, repeats per route, a quoted comma, a T/A name. */
const CSV = [
  "Organisation Name,Town/City,County,Type & Rating,Route",
  " AaruvikA Limited,Edinburgh,,Worker (A rating),Skilled Worker",
  " ROYAL LYCEUM THEATRE COMPANY LIMITED,Edinburgh,,Worker (A rating),Skilled Worker",
  " ROYAL LYCEUM THEATRE COMPANY LIMITED,Edinburgh,,Temporary Worker (A rating),Creative Worker",
  " NATIONAL THEATRE OF SCOTLAND,Glasgow,,Worker (A rating),Skilled Worker",
  " THEATRE ROYAL BATH LTD,Bath,Somerset,Worker (A rating),Skilled Worker",
  " EDINBURGH INTERNATIONAL FESTIVAL SOCIETY,Edinburgh,,Worker (A rating),Skilled Worker",
  " EDINBURGH INTERNATIONAL BOOK FESTIVAL,Edinburgh,,Worker (A rating),Skilled Worker",
  " NORTHERN BALLET SCHOOL LEEDS LTD,Leeds,,Worker (A rating),Skilled Worker",
  " NORTHERN BALLET SCHOOL MANCHESTER LTD,Manchester,,Worker (A rating),Skilled Worker",
  " PLAYHOUSE NURSERY LTD,Leeds,,Worker (A rating),Skilled Worker",
  ' "Smith, Jones & Partners LLP",London,,Worker (A rating),Skilled Worker',
  " BRANOS OXFORD LTD T/A LILO,Oxford,,Worker (A rating),Skilled Worker",
  " V AND A DUNDEE,Dundee,,Worker (A rating),Skilled Worker",
].join("\r\n");

function fakeFetch(map: Record<string, { status?: number; body?: string } | Error>): FetchLike {
  return async (url) => {
    const rule = map[url];
    if (rule instanceof Error) throw rule;
    if (!rule) return new Response("not found", { status: 404 });
    return new Response(rule.body ?? "", { status: rule.status ?? 200 });
  };
}

const CSV_URL = findCsvUrl(PAGE_HTML)!;
const bigCsv = () => `${CSV}\r\n${Array.from({ length: 1200 }, (_, i) => ` Filler Org ${i} Ltd,Town ${i},,Worker (A rating),Skilled Worker`).join("\r\n")}`;

beforeEach(() => resetTables());

describe("CSV parsing", () => {
  it("handles quoted commas, doubled quotes and CRLF", () => {
    expect(parseCsv('a,"b, c","say ""hi""",d\r\n1,2,3,4')).toEqual([["a", "b, c", 'say "hi"', "d"], ["1", "2", "3", "4"]]);
  });
  it("neutralises spreadsheet formula injection on export", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("has, comma")).toBe('"has, comma"');
  });
});

describe("register download and parsing (brief 2.7)", () => {
  it("finds the current .csv link on the publication page", () => {
    expect(findCsvUrl(PAGE_HTML)).toBe("https://assets.publishing.service.gov.uk/media/6aa2617592e72b8ac437f049/SP_-_Worker_and_Temporary_Worker_Web_Register_-_2026-09-10.csv");
    expect(findCsvUrl("<html>no link</html>")).toBeNull();
  });

  it("parses rows: trims leading spaces, keeps one row per route, indexes trading names, stores county and rating", () => {
    const rows = parseRegister(`﻿${CSV}`);
    const lyceum = rows.filter((r) => r.orgName === "ROYAL LYCEUM THEATRE COMPANY LIMITED");
    expect(lyceum).toHaveLength(2);
    expect(lyceum.map((r) => r.route).sort()).toEqual(["Creative Worker", "Skilled Worker"]);
    expect(lyceum[0]?.orgNorm).toBe("royal lyceum theatre");
    expect(rows.find((r) => r.orgName === "AaruvikA Limited")).toMatchObject({ orgNorm: "aaruvika", town: "Edinburgh", rating: "Worker (A rating)" });
    expect(rows.find((r) => r.orgName === "THEATRE ROYAL BATH LTD")?.county).toBe("Somerset");
    expect(rows.filter((r) => r.orgName === "BRANOS OXFORD LTD T/A LILO").map((r) => r.orgNorm).sort()).toEqual(["branos oxford", "lilo"]);
    expect(rows.find((r) => r.orgName === "Smith, Jones & Partners LLP")?.orgNorm).toBe("smith jones and partners");
  });

  it("refuses a file whose columns have changed, so the RECONCILE trigger fires instead of silent garbage", () => {
    expect(() => parseRegister("Organisation,Town,Route\nX,Y,Z")).toThrow(/columns have changed/);
  });

  it("downloads page → csv → table, records provenance, and is no longer stale", async () => {
    const now = Date.UTC(2026, 8, 14);
    const status = await downloadRegister({
      fetchImpl: fakeFetch({ [REGISTER_PAGE_URL]: { body: PAGE_HTML }, [CSV_URL]: { body: bigCsv() } }),
      now,
    });
    expect(status.available).toBe(true);
    expect(status.rows).toBeGreaterThan(1200);
    expect(status.sourceUrl).toBe(CSV_URL);
    expect(status.updatedAt).toBe(now);
    expect(status.lastError).toBeNull();
    expect(registerIsStale(now + 6 * 24 * 60 * 60_000)).toBe(false);
    expect(registerIsStale(now + 8 * 24 * 60 * 60_000)).toBe(true);
    expect(getDb().select().from(sponsorRegister).all().length).toBe(status.rows);
  });

  it("keeps the previous copy and records the error when the download fails", async () => {
    await downloadRegister({ fetchImpl: fakeFetch({ [REGISTER_PAGE_URL]: { body: PAGE_HTML }, [CSV_URL]: { body: bigCsv() } }), now: 1 });
    const before = registerStatus();

    const after = await downloadRegister({ fetchImpl: fakeFetch({ [REGISTER_PAGE_URL]: new TypeError("fetch failed") }), now: 2 });
    expect(after.available).toBe(true);
    expect(after.rows).toBe(before.rows);
    expect(after.updatedAt).toBe(1);
    expect(after.lastError).toMatch(/fetch failed/);

    const tooSmall = await downloadRegister({ fetchImpl: fakeFetch({ [REGISTER_PAGE_URL]: { body: PAGE_HTML }, [CSV_URL]: { body: CSV } }), now: 3 });
    expect(tooSmall.lastError).toMatch(/only \d+ rows/);
    expect(tooSmall.rows).toBe(before.rows);
  });
});

describe("matching against the stored register", () => {
  beforeEach(() => storeRegister(parseRegister(CSV), CSV_URL, 1));

  it("exact normalised match first", () => {
    expect(matchSponsor("Aaruvika Ltd")).toMatchObject({ name: "AaruvikA Limited", kind: "exact" });
    expect(matchSponsor("V&A Dundee")).toMatchObject({ name: "V AND A DUNDEE", kind: "exact" });
    expect(matchSponsor("Lilo")).toMatchObject({ name: "BRANOS OXFORD LTD T/A LILO", kind: "exact" });
  });

  it("then a conservative fuzzy match, storing the register's name", () => {
    // "Company" and "Limited" are stop words, so this one is exact — the better outcome.
    expect(matchSponsor("Royal Lyceum Theatre")).toMatchObject({ name: "ROYAL LYCEUM THEATRE COMPANY LIMITED", kind: "exact" });
    expect(matchSponsor("National Theatre Scotland")).toMatchObject({ name: "NATIONAL THEATRE OF SCOTLAND", kind: "fuzzy" });
    // Both festivals are in Edinburgh; the Society covers all three distinctive tokens, the Book Festival only 3 of 4.
    expect(matchSponsor("Edinburgh International Festival", "Edinburgh")).toMatchObject({ name: "EDINBURGH INTERNATIONAL FESTIVAL SOCIETY", kind: "fuzzy" });
  });

  it("declines the known false positives", () => {
    expect(matchSponsor("Playhouse")).toBeNull();
    expect(matchSponsor("Traverse Theatre")).toBeNull();
    expect(matchSponsor("Theatre Royal", "Edinburgh")).toBeNull(); // not the Royal Lyceum
    // "Bath" is that row's own town, so it isn't held against the listing.
    expect(matchSponsor("Theatre Royal", "Bath")).toMatchObject({ name: "THEATRE ROYAL BATH LTD" });
    expect(matchSponsor("")).toBeNull();
  });

  it("uses the listing's town to break a tie, and declines when it can't", () => {
    expect(matchSponsor("Northern Ballet School", "Leeds")).toMatchObject({ name: "NORTHERN BALLET SCHOOL LEEDS LTD", kind: "fuzzy" });
    expect(matchSponsor("Northern Ballet School", "Manchester")).toMatchObject({ name: "NORTHERN BALLET SCHOOL MANCHESTER LTD" });
    expect(matchSponsor("Northern Ballet School", "Edinburgh")).toBeNull();
    expect(matchSponsor("Northern Ballet School")).toBeNull();
  });

  it("the pipeline sets licensed_sponsor and the match name, and rematch updates old rows", async () => {
    const roleId = createRole({ name: "Comms" }).id;
    const l1 = listing({ org: "Royal Lyceum Theatre", title: "Marketing Manager", url: "https://a.example/1", locationNorm: "edinburgh" });
    const match1 = matchSponsor(l1.org, l1.locationNorm);
    const l2 = listing({ org: "Unknown Arts Org", title: "Officer", url: "https://a.example/2", locationNorm: "edinburgh" });
    const match2 = matchSponsor(l2.org, l2.locationNorm);

    mergeListings([
      { ...l1, licensedSponsor: !!match1, sponsorMatchName: match1?.name ?? null },
      { ...l2, licensedSponsor: !!match2, sponsorMatchName: match2?.name ?? null },
    ], { roleId, now: 1, provider: null, model: null });

    const jobs = listJobs();
    expect(jobs.find((j) => j.org === "Royal Lyceum Theatre")).toMatchObject({ licensedSponsor: true, sponsorMatchName: "ROYAL LYCEUM THEATRE COMPANY LIMITED" });
    expect(jobs.find((j) => j.org === "Unknown Arts Org")).toMatchObject({ licensedSponsor: false, sponsorMatchName: null });

    // A later register version adds the unknown org: rematch picks it up without touching anything else.
    storeRegister(parseRegister(`${CSV}\r\n UNKNOWN ARTS ORG LTD,Edinburgh,,Worker (A rating),Skilled Worker`), CSV_URL, 2);
    expect(rematchAllJobs()).toBe(1);
    expect(listJobs().find((j) => j.org === "Unknown Arts Org")?.licensedSponsor).toBe(true);
  });
});

describe("without the register (brief 2.7: the app still works)", () => {
  it("reports unavailable, matches nothing, and the pipeline still stores listings", async () => {
    expect(registerStatus()).toMatchObject({ available: false, rows: 0 });
    expect(matchSponsor("Royal Lyceum Theatre")).toBeNull();
    expect(rematchAllJobs()).toBe(0);

    const roleId = createRole({ name: "Comms" }).id;
    const l = listing({ org: "Royal Lyceum Theatre", title: "X", url: "https://a.example/1" });
    mergeListings([l], { roleId, now: 1, provider: null, model: null });

    const response = await getJobs(authed("/api/jobs"), params({}));
    const body = (await response.json()) as { register: { available: boolean } };
    expect(body.register.available).toBe(false);
  });
});

describe("GET /api/export.csv (brief 2.8)", () => {
  it("exports only tracked roles, with headers, and escapes untrusted text", async () => {
    const roleId = createRole({ name: "Comms" }).id;
    mergeListings([listing({ org: "=HYPERLINK(\"x\")", title: "Tracked one" }), listing({ org: "Untracked Co", title: "Not tracked" })], { roleId, now: 1000, provider: null, model: null });
    const tracked = listJobs().find((j) => j.title === "Tracked one")!;
    updateJobTracking(tracked.id, { status: "applied", notes: "Spoke to Sam, \"keen\"" }, 5000);

    const response = await exportCsv(authed("/api/export.csv"), params({}));
    expect(response.headers.get("Content-Type")).toMatch(/text\/csv/);
    expect(response.headers.get("Content-Disposition")).toMatch(/attachment; filename="tracked-roles-/);

    const text = await response.text();
    const lines = text.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Organisation,Role,Role type,My status,Applied on/);
    expect(lines[1]).toContain("'=HYPERLINK");
    expect(lines[1]).toContain("Applied");
    expect(lines[1]).toContain('"Spoke to Sam, ""keen"""');
    expect(text).not.toContain("Untracked Co");
  });
});
