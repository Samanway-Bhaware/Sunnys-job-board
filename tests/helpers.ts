import { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, createSessionToken } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { jobs, meta, refreshRuns, roles, settings, sponsorRegister, usageDaily } from "@/lib/db/schema";
import type { NormalisedListing } from "@/lib/jobs/types";

export const ORIGIN = "http://localhost:3000";

/** A request that passes the session and origin checks. */
export function authed(path: string, init: { method?: string; body?: unknown } = {}): NextRequest {
  const headers = new Headers({
    "Content-Type": "application/json",
    host: "localhost:3000",
    origin: ORIGIN,
    cookie: `${SESSION_COOKIE_NAME}=${createSessionToken()}`,
  });
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export function anon(path: string, init: { method?: string; body?: unknown } = {}): NextRequest {
  const headers = new Headers({ "Content-Type": "application/json", host: "localhost:3000", origin: ORIGIN });
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) });

/** Wipes every table so each test starts clean. */
export async function resetTables(): Promise<void> {
  const db = getDb();
  await db.delete(jobs);
  await db.delete(refreshRuns);
  await db.delete(roles);
  await db.delete(settings);
  await db.delete(meta);
  await db.delete(sponsorRegister);
  await db.delete(usageDaily);
}

let counter = 0;

export function listing(overrides: Partial<NormalisedListing> = {}): NormalisedListing {
  counter += 1;
  const url = overrides.url ?? `https://jobs.example.org/role-${counter}`;
  return {
    org: `Org ${counter}`,
    title: `Title ${counter}`,
    locationText: "Edinburgh",
    locationNorm: "Edinburgh",
    workMode: "hybrid",
    contract: "part_time",
    hoursText: "3 days/wk",
    salaryText: "£30,000",
    salaryMin: 30000,
    salaryMax: 30000,
    sponsorship: "not_stated",
    sponsorshipEvidence: "",
    postedDate: null,
    closingDate: null,
    url,
    canonicalUrl: url,
    source: "example.org",
    cited: false,
    linkStatus: "unchecked",
    ...overrides,
  };
}
