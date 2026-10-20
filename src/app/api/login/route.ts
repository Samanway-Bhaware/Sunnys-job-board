import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hasValidOrigin } from "@/lib/auth/origin";
import { verifyPassword } from "@/lib/auth/password";
import {
  checkRateLimit,
  clearFailures,
  lockoutAfterFailureMessage,
  rateLimitMessage,
  recordFailure,
} from "@/lib/auth/rate-limit";
import { clientIp } from "@/lib/auth/request";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/auth/session";

// Passwords must never be cached or prerendered.
export const dynamic = "force-dynamic";

const LoginBody = z.object({
  password: z.string().min(1).max(512),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!hasValidOrigin(request)) {
    return NextResponse.json(
      { ok: false, message: "That request looked unsafe, so it was blocked." },
      { status: 403 },
    );
  }

  const ip = clientIp(request.headers);

  // Rate limit is checked *before* the password is verified, so a blocked IP
  // learns nothing about whether its guess was right.
  const limit = checkRateLimit(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, message: rateLimitMessage(limit.retryAfterSeconds) },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const parsed = LoginBody.safeParse(body);
  if (!parsed.success) {
    recordFailure(ip);
    return NextResponse.json(
      { ok: false, message: "Enter the password to continue." },
      { status: 400 },
    );
  }

  if (!verifyPassword(parsed.data.password)) {
    recordFailure(ip);

    // This failure still counts as one of the allowed attempts, so it is a 401.
    // The 429 comes from the pre-check on the *next* request. Telling her here
    // that she has run out is kinder than letting the next attempt surprise her.
    const after = checkRateLimit(ip);
    return NextResponse.json(
      {
        ok: false,
        message: after.allowed
          ? "That password isn't right. Try again."
          : lockoutAfterFailureMessage(after.retryAfterSeconds),
      },
      { status: 401 },
    );
  }

  clearFailures(ip);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(), sessionCookieOptions());
  return response;
}
