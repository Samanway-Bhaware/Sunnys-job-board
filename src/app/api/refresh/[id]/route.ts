import { NextResponse } from "next/server";
import { fail, protectedRoute } from "@/lib/api";
import { getRun } from "@/lib/refresh/run";

export const dynamic = "force-dynamic";

/** Polled every 2 seconds by the board while a run is in progress. */
export const GET = protectedRoute(async (_request, { params }) => {
  const { id } = await params;
  const run = await getRun(id!);
  if (!run) return fail(404, "That search has finished and been cleared.", "not_found");
  return NextResponse.json({ ok: true, run });
});
