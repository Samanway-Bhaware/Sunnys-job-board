import { NextResponse } from "next/server";
import { z } from "zod";
import { isResponse, protectedRoute, readJson } from "@/lib/api";
import { MAX_LEN } from "@/lib/jobs/types";
import { startRefresh } from "@/lib/refresh/run";
import { createRole, listRoles, reorderRoles, toRoleView } from "@/lib/roles";

export const dynamic = "force-dynamic";

export const GET = protectedRoute(async () => {
  return NextResponse.json({ ok: true, roles: listRoles({ includeArchived: true }).map(toRoleView) });
});

const Create = z
  .object({
    name: z.string().trim().min(1, "give the role a name").max(MAX_LEN.roleName),
    keywords: z.string().trim().max(MAX_LEN.roleKeywords).optional().default(""),
  })
  .strict();

/**
 * Brief section 2.2: when she saves a new role, a search runs immediately for
 * just that role. The run id comes back so the board can show its progress chip.
 */
export const POST = protectedRoute(async (request) => {
  const body = await readJson(request, Create);
  if (isResponse(body)) return body;

  const role = createRole(body);
  const search = await startRefresh({ trigger: "role_added", roleIds: [role.id] });
  return NextResponse.json(
    { ok: true, role: toRoleView(role), run: search.started ? search.run : null, search },
    { status: 201 },
  );
});

const Reorder = z.object({ order: z.array(z.string()).max(50) }).strict();

/** Reorder: `{ order: [roleId, ...] }`. */
export const PATCH = protectedRoute(async (request) => {
  const body = await readJson(request, Reorder);
  if (isResponse(body)) return body;

  return NextResponse.json({ ok: true, roles: reorderRoles(body.order).map(toRoleView) });
});
