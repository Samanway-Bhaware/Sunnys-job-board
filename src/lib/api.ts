import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { requireSession } from "@/lib/auth/guard";
import { ensureMigrated } from "@/lib/db/migrate-runtime";
import { ensureSeeded } from "@/lib/db/seed";
import { log } from "@/lib/log";

/** Small helpers shared by every route handler. */

export type Handler = (request: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse>;

export function fail(status: number, message: string, error?: string): NextResponse {
  return NextResponse.json({ ok: false, error: error ?? "error", message }, { status });
}

export async function readJson<T>(request: NextRequest, schema: ZodType<T>): Promise<T | NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "That request wasn't in a format the site understands.", "bad_json");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join(".") ?? "";
    return fail(400, `Check ${where || "the form"}: ${first?.message ?? "invalid"}.`, "invalid");
  }
  return parsed.data;
}

export function isResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

/**
 * Wraps a handler with the session + origin check (defence in depth behind the
 * proxy gate) and turns thrown domain errors into plain-language responses.
 */
export function protectedRoute(handler: Handler): Handler {
  return async (request, ctx) => {
    const denied = requireSession(request);
    if (denied) return denied;
    try {
      if (process.env.NODE_ENV === "test") {
        await ensureMigrated();
      } else {
        await ensureSeeded();
      }
      return await handler(request, ctx);
    } catch (error) {
      if (error instanceof Error) {
        const status = STATUS_BY_ERROR[error.name] ?? 500;
        const message =
          status === 500 ? "Something went wrong on the server. Try again in a moment." : error.message;
        if (status === 500) log.error("api", `${request.method} ${request.nextUrl.pathname}`, error);
        return fail(status, message, error.name);
      }
      return fail(500, "Something went wrong on the server. Try again in a moment.");
    }
  };
}

const STATUS_BY_ERROR: Record<string, number> = {
  RoleLimitError: 409,
  RoleNotFoundError: 404,
  JobNotFoundError: 404,
  ProviderUnavailableError: 503,
  InvalidKeyError: 400,
};
