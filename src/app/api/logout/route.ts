import { NextResponse, type NextRequest } from "next/server";
import { hasValidOrigin } from "@/lib/auth/origin";
import { SESSION_COOKIE_NAME, clearedSessionCookieOptions } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** Settings > "Sign out of this device" (brief section 2.9.5). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!hasValidOrigin(request)) {
    return NextResponse.json(
      { ok: false, message: "That request looked unsafe, so it was blocked." },
      { status: 403 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", clearedSessionCookieOptions());
  return response;
}
