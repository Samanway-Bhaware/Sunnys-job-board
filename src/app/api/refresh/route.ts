import { after, NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, protectedRoute, readJson } from "@/lib/api";
import { startRefresh, waitForRun } from "@/lib/refresh/run";

export const dynamic = "force-dynamic";

const Body = z.object({ trigger: z.enum(["visit", "manual"]) }).strict();

/**
 * Brief 2.4. "visit" respects the cooldown; "manual" bypasses it. Both respect
 * the daily cap (default key only) and the one-run-at-a-time lock.
 */
export const POST = protectedRoute(async (request) => {
  const body = await readJson(request, Body);
  if (isResponse(body)) return body;

  const result = await startRefresh({ trigger: body.trigger });
  if (result.started) {
    try {
      after(async () => {
        await waitForRun(result.run.id);
      });
    } catch {
      // Outside Next.js request context (e.g. unit tests)
    }
  }
  return NextResponse.json({ ok: true, ...result }, { status: result.started ? 202 : 200 });
});
