import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, protectedRoute, readJson } from "@/lib/api";
import { toJobView, updateJobTracking } from "@/lib/jobs/queries";
import { MAX_LEN, STATUSES } from "@/lib/jobs/types";

export const dynamic = "force-dynamic";

/** Brief: status and notes only. Nothing else on a listing is hers to edit. */
const Patch = z
  .object({
    status: z.enum(STATUSES).optional(),
    notes: z.string().max(MAX_LEN.notes).optional(),
  })
  .strict();

export const PATCH = protectedRoute(async (request, { params }) => {
  const { id } = await params;
  const body = await readJson(request, Patch);
  if (isResponse(body)) return body;

  const row = updateJobTracking(id!, body);
  return NextResponse.json({ ok: true, job: toJobView(row) });
});
