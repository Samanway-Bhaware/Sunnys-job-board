import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, protectedRoute, readJson } from "@/lib/api";
import { MAX_LEN } from "@/lib/jobs/types";
import { getEnv } from "@/lib/env";
import { currentUsage, latestRun } from "@/lib/refresh/run";
import { ALL_SCRAPERS } from "@/lib/scrapers";
import { getScope, getSettings, updateScope } from "@/lib/settings";
import { registerStatus } from "@/lib/sponsor/register";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async () => {
  const row = getSettings();
  const env = getEnv();
  const scrapers = ALL_SCRAPERS.map((s) => ({
    id: s.id,
    name: s.name,
    requiresKey: s.requiresKey,
    configured: s.isConfigured(),
  }));

  return NextResponse.json({
    ok: true,
    scope: getScope(),
    provider: "scrapers",
    model: null,
    seenUpTo: row.seenUpTo,
    lastRefreshAt: row.lastRefreshAt,
    providers: [],
    scrapers,
    cooldownMinutes: env.REFRESH_COOLDOWN_MINUTES,
    dailyCap: 0,
    usage: await currentUsage(),
    lastRun: latestRun(),
    register: registerStatus(),
  });
});

const ScopePatch = z
  .object({
    sector: z.string().trim().min(1).max(MAX_LEN.sector),
    locations: z.array(z.string().trim().min(1).max(MAX_LEN.locationEntry)).max(20),
    notes: z.string().trim().max(MAX_LEN.searchNotes),
  })
  .strict();

export const PATCH = protectedRoute(async (request) => {
  const body = await readJson(request, ScopePatch);
  if (isResponse(body)) return body;
  return NextResponse.json({ ok: true, scope: updateScope(body) });
});
