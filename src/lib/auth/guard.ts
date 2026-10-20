import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./session";
import { hasValidOrigin } from "./origin";

/**
 * Defence in depth for route handlers. The proxy gate already blocks
 * unauthenticated requests, but the Next.js docs are explicit that a matcher
 * change or a refactor can silently remove proxy coverage, so every handler that
 * touches data re-checks here rather than trusting the gate alone.
 */
export function requireSession(request: NextRequest): NextResponse | null {
  if (!verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value)) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated", message: "Please sign in again." },
      { status: 401 },
    );
  }

  if (!hasValidOrigin(request)) {
    return NextResponse.json(
      { ok: false, error: "bad_origin", message: "That request looked unsafe, so it was blocked." },
      { status: 403 },
    );
  }

  return null;
}
