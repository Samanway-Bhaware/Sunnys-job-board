import { eq, ilike, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
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

async function readMeta(key: string): Promise<string | null> {
  const rows = await getDb().select().from(meta).where(eq(meta.key, key));
  return rows[0]?.value ?? null;
}

async function writeMeta(key: string, value: string): Promise<void> {
  await getDb().insert(meta).values({ key, value }).onConflictDoUpdate({ target: meta.key, set: { value } });
}

export async function registerStatus(): Promise<RegisterStatus> {
  const rows = Number((await readMeta(META_ROWS)) ?? 0);
  const updatedAt = await readMeta(META_UPDATED);
  return {
    available: rows > 0,
    rows,
    updatedAt: updatedAt ? Number(updatedAt) : null,
    sourceUrl: await readMeta(META_SOURCE),
    lastError: await readMeta(META_ERROR),
  };
}

export async function registerIsStale(now: number = Date.now()): Promise<boolean> {
  const status = await registerStatus();
  if (!status.available || !status.updatedAt) return true;
  return now - status.updatedAt >= REGISTER_MAX_AGE_MS;
}

export class RegisterFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegisterFormatError";
  }
}

/** Finds the first direct link to the CSV on the gov.uk publication page. */
export function findCsvUrl(html: string): string | null {
  const match = html.match(/href="([^"]+\.csv)"/i) ?? html.match(/href='([^']+\.csv)'/i);
  if (!match) return null;
  const href = match[1]!;
  return href.startsWith("http") ? href : `https://www.gov.uk${href}`;
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
  const table = parseCsv(csv.replace(/^\uFEFF/, ""));
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

/** Replaces the table wholesale and records provenance. */
export async function storeRegister(rows: RegisterRow[], sourceUrl: string, now: number = Date.now()): Promise<void> {
  const db = getDb();
  await db.delete(sponsorRegister);
  const CHUNK_SIZE = 500;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    await db.insert(sponsorRegister).values(rows.slice(i, i + CHUNK_SIZE)).onConflictDoNothing();
  }
  await writeMeta(META_ROWS, String(rows.length));
  await writeMeta(META_UPDATED, String(now));
  await writeMeta(META_SOURCE, sourceUrl);
  await db.delete(meta).where(eq(meta.key, META_ERROR));
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

    await storeRegister(rows, csvUrl, now);
    await rematchAllJobs();
  } catch (error) {
    await writeMeta(META_ERROR, error instanceof Error ? error.message.slice(0, 300) : "Download failed.");
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
export async function matchSponsor(orgName: string, locationNorm = ""): Promise<SponsorMatch | null> {
  const norm = normaliseOrgName(orgName);
  if (!norm) return null;
  const db = getDb();

  const exact = await db.select().from(sponsorRegister).where(eq(sponsorRegister.orgNorm, norm));
  if (exact.length > 0) {
    const r = exact[0]!;
    return { name: r.orgName, town: r.town, rating: r.rating, route: r.route, kind: "exact" };
  }

  // Candidate generation: rows sharing the listing's *rarest* usable token.
  const tokens = strongTokens(orgName)
    .filter((t) => t.length >= 4)
    .map((t) => t.replace(/[%_]/g, ""))
    .filter(Boolean);
  if (tokens.length === 0) return null;

  const tokenCounts = await Promise.all(
    tokens.map(async (token) => {
      const rows = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(sponsorRegister)
        .where(ilike(sponsorRegister.orgNorm, `%${token}%`));
      return { token, n: rows[0]?.n ?? 0 };
    }),
  );
  tokenCounts.sort((a, b) => a.n - b.n);
  const anchor = tokenCounts[0]!;
  if (anchor.n === 0) return null;

  const candidates = distinctByName(
    await db
      .select()
      .from(sponsorRegister)
      .where(ilike(sponsorRegister.orgNorm, `%${anchor.token}%`))
      .limit(3000),
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
export async function rematchAllJobs(): Promise<number> {
  const db = getDb();
  if (!(await registerStatus()).available) return 0;
  const rows = await db
    .select({
      id: jobs.id,
      org: jobs.org,
      locationNorm: jobs.locationNorm,
      licensedSponsor: jobs.licensedSponsor,
      sponsorMatchName: jobs.sponsorMatchName,
    })
    .from(jobs);

  const updates: { id: string; licensed: boolean; matchName: string | null }[] = [];
  for (const row of rows) {
    const match = await matchSponsor(row.org, row.locationNorm);
    const licensed = match !== null;
    if (licensed !== row.licensedSponsor || (match?.name ?? null) !== row.sponsorMatchName) {
      updates.push({ id: row.id, licensed, matchName: match?.name ?? null });
    }
  }

  for (const u of updates) {
    await db
      .update(jobs)
      .set({ licensedSponsor: u.licensed, sponsorMatchName: u.matchName })
      .where(eq(jobs.id, u.id));
  }

  return updates.length;
}

/* ---------- scheduling ---------- */

let timer: NodeJS.Timeout | null = null;

/** Startup: refresh in the background if stale, then check daily (it only downloads when a week old). */
export function scheduleRegisterRefresh(): void {
  if (!getEnv().SPONSOR_REGISTER_REFRESH) {
    log.info("sponsor-register", "scheduled refresh disabled (SPONSOR_REGISTER_REFRESH=0)");
    return;
  }
  const tick = async () => {
    if (!(await registerIsStale())) return;
    const s = await downloadRegister();
    if (s.lastError) log.warn("sponsor-register", `not refreshed: ${s.lastError}`);
    else log.info("sponsor-register", `${s.rows} rows loaded`);
  };
  setTimeout(() => { void tick(); }, 5_000).unref();
  if (!timer) {
    timer = setInterval(() => { void tick(); }, DAY_MS);
    timer.unref();
  }
}
