import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, protectedRoute, readJson } from "@/lib/api";
import { MAX_LEN } from "@/lib/jobs/types";
import { deleteRole, toRoleView, updateRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

const Patch = z
  .object({
    name: z.string().trim().min(1).max(MAX_LEN.roleName).optional(),
    keywords: z.string().trim().max(MAX_LEN.roleKeywords).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const PATCH = protectedRoute(async (request, { params }) => {
  const { id } = await params;
  const body = await readJson(request, Patch);
  if (isResponse(body)) return body;

  return NextResponse.json({ ok: true, role: toRoleView(updateRole(id!, body)) });
});

export const DELETE = protectedRoute(async (_request, { params }) => {
  const { id } = await params;
  const outcome = deleteRole(id!);
  return NextResponse.json({ ok: true, outcome });
});
