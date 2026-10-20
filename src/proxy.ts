import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  sessionCookieOptions,
  verifySessionToken,
} from "@/lib/auth/session";
import { STATIC_SECURITY_HEADERS, buildCsp, newNonce } from "@/lib/security-headers";

/**
 * The auth gate and the security headers.
 *
 * Next.js 16 renamed the `middleware` convention to `proxy` and it now runs on the
 * Node.js runtime (the runtime is not configurable here), which is why this file
 * can use node:crypto by way of the session module.
 * https://nextjs.org/docs/app/api-reference/file-conventions/proxy
 *
 * Note the caveat in those docs: a matcher that excludes a path also skips Server
 * Function calls on that path. This gate is therefore the outer layer only —
 * route handlers re-check with `requireSession()` from @/lib/auth/guard.
 */

/** Reachable without a session. Everything else is gated. */
const PUBLIC_PATHS = new Set<string>(["/login"]);
const PUBLIC_API_PATHS = new Set<string>(["/api/login"]);

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_API_PATHS.has(pathname);
}

function withSecurityHeaders(response: NextResponse, csp: string): NextResponse {
  for (const [key, value] of Object.entries(STATIC_SECURITY_HEADERS)) response.headers.set(key, value);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

function issueSession(response: NextResponse): NextResponse {
  // Re-issued on every authenticated request so the 400-day window slides
  // forward and she is never asked to sign in again while she keeps visiting.
  response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(), sessionCookieOptions());
  return response;
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const signedIn = verifySessionToken(token);

  // A fresh nonce per request. Next.js reads it from the request's CSP header
  // and applies it to its own scripts, so the page renders under a strict CSP.
  const nonce = newNonce();
  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });

  if (isPublic(pathname)) {
    // Already signed in and heading for the login page: send her to the board.
    if (signedIn && pathname === "/login") {
      return withSecurityHeaders(issueSession(NextResponse.redirect(new URL("/", request.url))), csp);
    }
    return withSecurityHeaders(next(), csp);
  }

  if (signedIn) {
    return withSecurityHeaders(issueSession(next()), csp);
  }

  if (pathname.startsWith("/api/")) {
    return withSecurityHeaders(
      NextResponse.json(
        { ok: false, error: "not_authenticated", message: "Please sign in again." },
        { status: 401 },
      ),
      csp,
    );
  }

  const loginUrl = new URL("/login", request.url);
  const attempted = `${pathname}${search}`;
  if (attempted !== "/") loginUrl.searchParams.set("next", attempted);
  return withSecurityHeaders(NextResponse.redirect(loginUrl), csp);
}

export const config = {
  // Everything except static assets. API routes are deliberately included —
  // excluding them is the classic way to leave an app's data wide open.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
