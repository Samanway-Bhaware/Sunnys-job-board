import { NextResponse } from "next/server";
import { protectedRoute } from "@/lib/api";
import { todayString } from "@/lib/dates";
import { listJobs } from "@/lib/jobs/queries";
import { STATUS_LABELS, type Status } from "@/lib/jobs/types";
import { listRoles } from "@/lib/roles";
import { toCsv } from "@/lib/sponsor/csv";

export const dynamic = "force-dynamic";

const MODE = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site", unknown: "" } as const;
const CONTRACT = { full_time: "Full-time", part_time: "Part-time", unknown: "" } as const;
const SPONSORSHIP = { offered: "Offered", not_offered: "Not offered", not_stated: "Not stated" } as const;

/** Brief 2.8: "Export tracked roles (CSV)". Tracked = any status set. */
export const GET = protectedRoute(async () => {
  const [allRoles, allJobs] = await Promise.all([
    listRoles({ includeArchived: true }),
    listJobs(),
  ]);
  const roleName = new Map(allRoles.map((r) => [r.id, r.name]));
  const tracked = allJobs.filter((j) => j.status !== "");

  const rows = tracked.map((j) => [
    j.org,
    j.title,
    roleName.get(j.roleId) ?? "",
    STATUS_LABELS[(j.status as Status) ?? ""] ?? j.status,
    j.appliedAt ? todayString(j.appliedAt) : "",
    j.locationText,
    MODE[j.workMode as keyof typeof MODE] ?? "",
    CONTRACT[j.contract as keyof typeof CONTRACT] ?? "",
    j.hoursText,
    j.salaryText,
    j.closingDate ?? "",
    SPONSORSHIP[j.sponsorship as keyof typeof SPONSORSHIP] ?? "",
    j.licensedSponsor ? `Yes (${j.sponsorMatchName ?? ""})` : "",
    j.notes,
    j.url,
  ]);

  const csv = toCsv(
    ["Organisation", "Role", "Role type", "My status", "Applied on", "Location", "Work mode", "Contract", "Hours", "Salary", "Closing date", "Sponsorship (listing)", "Licensed sponsor", "Notes", "Link"],
    rows,
  );

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tracked-roles-${todayString()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
