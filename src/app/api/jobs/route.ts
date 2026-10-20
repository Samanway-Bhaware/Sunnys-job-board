import { NextResponse } from "next/server";
import { protectedRoute } from "@/lib/api";
import { listJobs, toJobView } from "@/lib/jobs/queries";
import { cooldownRemaining } from "@/lib/refresh/policy";
import { currentUsage, latestRun } from "@/lib/refresh/run";
import { listRoles, toRoleView } from "@/lib/roles";
import { getScope, getSettings } from "@/lib/settings";
import { registerStatus } from "@/lib/sponsor/register";

export const dynamic = "force-dynamic";

/** Everything the board needs on load. Filters are applied in the browser. */
export const GET = protectedRoute(async () => {
  const settings = getSettings();
  const run = latestRun();

  return NextResponse.json({
    ok: true,
    jobs: listJobs().map(toJobView),
    roles: listRoles({ includeArchived: true }).map(toRoleView),
    scope: getScope(),
    /** The client reads this once as `newSince` (brief section 2.5, "New" badge). */
    seenUpTo: settings.seenUpTo,
    lastRefreshAt: settings.lastRefreshAt,
    activeRun: run && run.status === "running" ? run : null,
    lastRun: run,
    usage: await currentUsage(),
    register: registerStatus(),
    cooldownRemainingMs: cooldownRemaining(),
  });
});
