import { describe, expect, it } from "vitest";
import { isFuzzyMatch, tokenSetSimilarity, FUZZY_THRESHOLD } from "@/lib/sponsor/match";
import { normaliseOrgName, orgTokens, registerAliases } from "@/lib/sponsor/normalise";

describe("name normalisation (brief 2.7)", () => {
  it("lowercases, strips punctuation and drops corporate suffixes and articles", () => {
    expect(normaliseOrgName("The Royal Lyceum Theatre Company Limited")).toBe("royal lyceum theatre");
    expect(normaliseOrgName("NATIONAL THEATRE OF SCOTLAND")).toBe("national theatre of scotland");
    expect(normaliseOrgName("Scottish Book Trust")).toBe("scottish book");
    expect(normaliseOrgName("Creative Scotland (CIC)")).toBe("creative scotland");
    expect(normaliseOrgName("Fruitmarket Gallery Ltd.")).toBe("fruitmarket gallery");
    expect(normaliseOrgName("Design Museum PLC")).toBe("design museum");
    expect(normaliseOrgName("Edinburgh Printmakers LLP")).toBe("edinburgh printmakers");
  });

  it("treats & as 'and' and ignores apostrophes and leading spaces", () => {
    expect(normaliseOrgName("V&A Dundee")).toBe("v and a dundee");
    expect(normaliseOrgName("V and A Dundee")).toBe("v and a dundee");
    expect(normaliseOrgName("  AaruvikA Limited")).toBe("aaruvika");
    expect(normaliseOrgName("Sadler's Wells")).toBe("sadlers wells");
  });

  it("V&A and 'V and A' are the same name once normalised (exact match territory, not fuzzy)", () => {
    expect(normaliseOrgName("V&A Dundee")).toBe(normaliseOrgName("V AND A DUNDEE"));
  });

  it("dedupes tokens", () => {
    expect(orgTokens("CAKE GLORY LTD LTD")).toEqual(["cake", "glory"]);
  });

  it("indexes trading names separately", () => {
    expect(registerAliases("BRANOS OXFORD LTD T/A LILO")).toEqual(expect.arrayContaining(["branos oxford", "lilo"]));
    expect(registerAliases("CASA BAMBOO LTD T/a Pho Le Vietnamese Restaurant")).toEqual(expect.arrayContaining(["casa bamboo", "pho le vietnamese restaurant"]));
    expect(registerAliases("Plain Name Ltd")).toEqual(["plain name"]);
  });
});

describe("fuzzy match — pairs that MUST match", () => {
  const yes: [string, string, string?][] = [
    ["National Theatre of Scotland", "NATIONAL THEATRE OF SCOTLAND"],
    ["Royal Lyceum Theatre", "ROYAL LYCEUM THEATRE COMPANY LIMITED"],
    ["Northern Ballet School", "NORTHERN BALLET SCHOOL LEEDS LTD", "Leeds"],
    // "Workshop" and "Society" say what kind of body it is, not which one.
    ["Edinburgh Printmakers", "EDINBURGH PRINTMAKERS WORKSHOP LTD"],
    ["Edinburgh International Festival", "EDINBURGH INTERNATIONAL FESTIVAL SOCIETY"],
    ["Scottish Book Trust", "THE SCOTTISH BOOK TRUST"],
    ["Edinburgh International Festival", "EDINBURGH INTERNATIONAL FESTIVAL SOCIETY"],
    ["National Theatre Scotland", "NATIONAL THEATRE OF SCOTLAND"],
    ["Dundee Contemporary Arts", "DUNDEE CONTEMPORARY ARTS LTD"],
  ];
  it.each(yes)("%s ≈ %s", (a, b, town) => {
    expect(isFuzzyMatch(a, b, town ?? "")).toBe(true);
  });
});

describe("fuzzy match — known false-positive pairs that must NOT match", () => {
  const no: [string, string][] = [
    ["Playhouse", "PLAYHOUSE NURSERY LTD"],
    ["Edinburgh", "EDINBURGH COUNCIL"],
    ["Creative Scotland", "CREATIVE SCOTLAND RECRUITMENT SOLUTIONS LTD"],
    ["Traverse Theatre", "TRAMWAY THEATRE LTD"],
    ["Scottish Opera", "SCOTTISH BALLET"],
    ["Dundee Rep", "DUNDEE CONTEMPORARY ARTS"],
    ["National Gallery", "NATIONAL MUSEUM LTD"],
    ["Glasgow Life", "GLASGOW LIFE SCIENCES LIMITED"],
    ["Arts Council", "ART FUND"],
    ["Theatre", "THEATRE ROYAL BATH LTD"],
    // Without the town, "Leeds" is a distinctive word the listing lacks.
    ["Northern Ballet School", "NORTHERN BALLET SCHOOL LEEDS LTD"],
    // Found on the live register: {a, and, dundee} looked like three shared tokens.
    ["V&A Dundee", "A&M DUNDEE LTD"],
    ["V&A Dundee", "V&A SONS LTD"],
    // Word order is invisible to token sets; these are different organisations.
    ["Theatre Royal", "ROYAL LYCEUM THEATRE COMPANY LIMITED"],
    // The distinctive word differs.
    ["Edinburgh International Festival", "EDINBURGH INTERNATIONAL BOOK FESTIVAL"],
  ];
  it.each(no)("%s ≠ %s", (a, b) => {
    expect(isFuzzyMatch(a, b)).toBe(false);
  });

  it("explains the threshold: a subset scores 1.0 on token_set_ratio alone, so the guards do the work", () => {
    const s = tokenSetSimilarity("Playhouse", "Playhouse Nursery Ltd");
    expect(s.score).toBe(1);
    expect(s.shared).toBe(1);
    expect(s.coverage).toBe(0.5);
    const tr = tokenSetSimilarity("Theatre Royal", "Royal Lyceum Theatre");
    expect(tr.score).toBe(1);
    expect(tr.coverage).toBeCloseTo(2 / 3);
    expect(FUZZY_THRESHOLD).toBe(0.92);
  });
});
