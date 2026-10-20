import { eq, like, sql } from "drizzle-orm";
import { getDb, getSqlite } from "@/lib/db";
import { jobs, meta, sponsorRegister } from "@/lib/db/schema";
import { DAY_MS } from "@/lib/dates";
import { getEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { parseCsv } from "./csv";
import { isFuzzyMatch, strongTokens, tokenSetSimilarity } from "./match";
import { normaliseOrgName, registerAliases } from "./normalise";

/**
 * UK Home Office "Register of licensed sponsors: workers" (brief 2.7).
 *
 * Verified 2026-09-11 (docs/provider-notes.md §5): the publication page links one
 * CSV whose filename changes with every update, so the page is scraped for the
 * current link. Columns: Organisation Name, Town/City, County, Type & Rating,
 * Route. Values carry leading spaces; organisations repeat once per route.
 */

export const REGISTER_PAGE_URL =
  "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers";

/** Refresh on startup if older than this, and weekly after that. */
export const REGISTER_MAX_AGE_MS = 7 * DAY_MS;

const META_UPDATED = "sponsor_register_updated_at";
const META_SOURCE = "sponsor_register_source_url";
const META_ROWS = "sponsor_register_rows";
const META_ERROR = "sponsor_register_last_error";

const EXPECTED_HEADER = ["Organisation Name", "Town/City", "County", "Type & Rating", "Route"];

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RegisterStatus {
  available: boolean;
  rows: number;
  updatedAt: number | null;
  sourceUrl: string | null;
  lastError: string | null;
}

function readMeta(key: string): string | null {
  return getDb().select().from(meta).where(eq(meta.key, key)).get()?.value ?? null;
}

function writeMeta(key: string, value: string): void {
  getDb().insert(meta).values({ key, value }).onConflictDoUpdate({ target: meta.key, set: { value } }).run();
}

export function registerStatus(): RegisterStatus {
  const rows = Number(readMeta(META_ROWS) ?? 0);
  const updatedAt = readMeta(META_UPDATED);
  return {
    available: rows > 0,
    rows,
    updatedAt: updatedAt ? Number(updatedAt) : null,
    sourceUrl: readMeta(META_SOURCE),
    lastError: readMeta(META_ERROR),
  };
}

export function registerIsStale(now: number = Date.now()): boolean {
  const status = registerStatus();
  return !status.available || status.updatedAt === null || now - status.updatedAt > REGISTER_MAX_AGE_MS;
}

/** The current CSV link on the publication page. */
export function findCsvUrl(html: string): string | null {
  const match = html.match(/https:\/\/assets\.publishing\.service\.gov\.uk\/[^"'\s<>]+?\.csv/i);
  return match ? match[0] : null;
}

export class RegisterFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegisterFormatError";
  }
}

export interface RegisterRow {
  orgName: string;
  orgNorm: string;
  town: string;
  county: string;
  rating: string;
  route: string;
}

/** Parses the CSV text into rows, one per alias per route. Throws if the columns moved. */
export function parseRegister(csv: string): RegisterRow[] {
  const table = parseCsv(csv.replace(/^﻿/, ""));
  const header = (table[0] ?? []).map((h) => h.trim());
  const missing = EXPECTED_HEADER.filter((h) => !header.includes(h));
  if (missing.length > 0) {
    throw new RegisterFormatError(
      `The sponsor register's columns have changed. Missing: ${missing.join(", ")}. Found: ${header.join(", ")}`,
    );
  }
  const col = Object.fromEntries(EXPECTED_HEADER.map((h) => [h, header.indexOf(h)])) as Record<string, number>;

  const rows: RegisterRow[] = [];
  const seen = new Set<string>();
  for (const line of table.slice(1)) {
    const orgName = (line[col["Organisation Name"]!] ?? "").trim();
    if (!orgName) continue;
    const town = (line[col["Town/City"]!] ?? "").trim();
    const county = (line[col["County"]!] ?? "").trim();
    const rating = (line[col["Type & Rating"]!] ?? "").trim();
    const route = (line[col["Route"]!] ?? "").trim();

    for (const orgNorm of registerAliases(orgName)) {
      const key = `${orgNorm}||${route}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ orgName, orgNorm, town, county, rating, route });
    }
  }
  return rows;
}

/** Replaces the table wholesale, inside one transaction, and records provenance. */
export function storeRegister(rows: RegisterRow[], sourceUrl: string, now: number = Date.now()): void {
  const sqlite = getSqlite();
  const insert = sqlite.prepare(
    "INSERT OR IGNORE INTO sponsor_register (org_name, org_norm, town, county, rating, route) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const run = sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM sponsor_register").run();
    for (const r of rows) insert.run(r.orgName, r.orgNorm, r.town, r.county, r.rating, r.route);
  });
  run();
  writeMeta(META_ROWS, String(rows.length));
  writeMeta(META_UPDATED, String(now));
  writeMeta(META_SOURCE, sourceUrl);
  getDb().delete(meta).where(eq(meta.key, META_ERROR)).run();
}

/**
 * Downloads and stores the register. On any failure the previous copy is kept
 * and the error recorded — the app keeps working without it (brief 2.7).
 */
export async function downloadRegister(options: { fetchImpl?: FetchLike; now?: number } = {}): Promise<RegisterStatus> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now();
  const headers = { "User-Agent": "Mozilla/5.0 (compatible; sunnynunny-jobboard/1.0)" };

  try {
    const page = await fetchImpl(REGISTER_PAGE_URL, { headers, signal: AbortSignal.timeout(30_000) });
    if (!page.ok) throw new Error(`The register page returned ${page.status}.`);
    const csvUrl = findCsvUrl(await page.text());
    if (!csvUrl) throw new RegisterFormatError("Couldn't find a .csv link on the register page.");

    const file = await fetchImpl(csvUrl, { headers, signal: AbortSignal.timeout(120_000) });
    if (!file.ok) throw new Error(`The register CSV returned ${file.status}.`);
    const rows = parseRegister(await file.text());
    if (rows.length < 1000) throw new RegisterFormatError(`The register looked wrong: only ${rows.length} rows.`);

    storeRegister(rows, csvUrl, now);
    rematchAllJobs();
  } catch (error) {
    writeMeta(META_ERROR, error instanceof Error ? error.message.slice(0, 300) : "Download failed.");
  }
  return registerStatus();
}

/* ---------- matching ---------- */

export interface SponsorMatch {
  name: string;
  town: string;
  rating: string;
  route: string;
  kind: "exact" | "fuzzy";
}

type Row = typeof sponsorRegister.$inferSelect;

function distinctByName(rows: Row[]): Row[] {
  const byName = new Map<string, Row>();
  for (const r of rows) if (!byName.has(r.orgName)) byName.set(r.orgName, r);
  return [...byName.values()];
}

/**
 * Brief 2.7: exact normalised match, then conservative fuzzy. If the fuzzy step
 * finds several different organisations it keeps only the best-covered ones,
 * then prefers one in the listing's town; if that still leaves more than one it
 * declines rather than guess.
 */
export function matchSponsor(orgName: string, locationNorm = ""): SponsorMatch | null {
  const norm = normaliseOrgName(orgName);
  if (!norm) return null;
  const db = getDb();

  const exact = db.select().from(sponsorRegister).where(eq(sponsorRegister.orgNorm, norm)).all();
  if (exact.length > 0) {
    const r = exact[0]!;
    return { name: r.orgName, town: r.town, rating: r.rating, route: r.route, kind: "exact" };
  }

  // Candidate generation: rows sharing the listing's *rarest* usable token. The
  // longest token is not the rarest — "international" appears in 2,400 register
  // rows and hid "Edinburgh International Festival Society" behind a result cap.
  const tokens = strongTokens(orgName)
    .filter((t) => t.length >= 4)
    .map((t) => t.replace(/[%_]/g, ""))
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const anchor = tokens
    .map((token) => ({
      token,
      n: db.select({ n: sql<number>`count(*)` }).from(sponsorRegister).where(like(sponsorRegister.orgNorm, `%${token}%`)).get()?.n ?? 0,
    }))
    .sort((a, b) => a.n - b.n)[0]!;
  if (anchor.n === 0) return null;

  const candidates = distinctByName(
    db
      .select()
      .from(sponsorRegister)
      .where(like(sponsorRegister.orgNorm, `%${anchor.token}%`))
      .limit(3000)
      .all(),
  ).filter((r) => isFuzzyMatch(orgName, r.orgName, townHint(r.town, locationNorm)));

  if (candidates.length === 0) return null;

  const scored = candidates.map((c) => ({ c, s: tokenSetSimilarity(orgName, c.orgName, townHint(c.town, locationNorm)) }));
  const best = Math.max(...scored.map((x) => x.s.coverage));
  let pool = scored.filter((x) => x.s.coverage === best).map((x) => x.c);
  if (pool.length > 1 && locationNorm) {
    const town = locationNorm.toLowerCase();
    pool = pool.filter((c) => c.town.toLowerCase() === town);
  }
  if (pool.length !== 1) return null;

  const pick = pool[0]!;
  return { name: pick.orgName, town: pick.town, rating: pick.rating, route: pick.route, kind: "fuzzy" };
}

/**
 * A row's town stops counting as a distinctive word only when the listing is in
 * that town. "Citizens Theatre" in Glasgow must not match "York Citizen's Theatre".
 */
function townHint(rowTown: string, locationNorm: string): string {
  return locationNorm && rowTown.toLowerCase() === locationNorm.toLowerCase() ? rowTown : "";
}

/** Re-runs matching over every stored job, e.g. after the register is refreshed. */
export function rematchAllJobs(): number {
  const db = getDb();
  if (!registerStatus().available) return 0;
  let changed = 0;
  const rows = db.select({ id: jobs.id, org: jobs.org, locationNorm: jobs.locationNorm, licensedSponsor: jobs.licensedSponsor, sponsorMatchName: jobs.sponsorMatchName }).from(jobs).all();
  db.transaction((tx) => {
    for (const row of rows) {
      const match = matchSponsor(row.org, row.locationNorm);
      const licensed = match !== null;
      const name = match?.name ?? null;
      if (row.licensedSponsor === licensed && row.sponsorMatchName === name) continue;
      tx.update(jobs).set({ licensedSponsor: licensed, sponsorMatchName: name }).where(sql`${jobs.id} = ${row.id}`).run();
      changed += 1;
    }
  });
  return changed;
}

/* ---------- scheduling ---------- */

let timer: NodeJS.Timeout | null = null;

/** Startup: refresh in the background if stale, then check daily (it only downloads when a week old). */
export function scheduleRegisterRefresh(): void {
  if (!getEnv().SPONSOR_REGISTER_REFRESH) {
    log.info("sponsor-register", "scheduled refresh disabled (SPONSOR_REGISTER_REFRESH=0)");
    return;
  }
  const tick = () => {
    if (!registerIsStale()) return;
    void downloadRegister().then((s) => {
      if (s.lastError) log.warn("sponsor-register", `not refreshed: ${s.lastError}`);
      else log.info("sponsor-register", `${s.rows} rows loaded`);
    });
  };
  setTimeout(tick, 5_000).unref();
  if (!timer) {
    timer = setInterval(tick, DAY_MS);
    timer.unref();
  }
}
