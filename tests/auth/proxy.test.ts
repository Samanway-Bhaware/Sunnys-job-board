import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import { SESSION_COOKIE_NAME, createSessionToken, verifySessionToken } from "@/lib/auth/session";

const ORIGIN = "http://localhost:3000";

function request(path: string, token?: string) {
  const headers = new Headers({ host: "localhost:3000" });
  if (token) headers.set("cookie", `${SESSION_COOKIE_NAME}=${token}`);
  return new NextRequest(`${ORIGIN}${path}`, { headers });
}

describe("proxy auth gate", () => {
  it("redirects an unauthenticated page request to /login, remembering where she was going", () => {
    const response = proxy(request("/settings"));

    expect([307, 308]).toContain(response.status);

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/settings");
  });

  it("returns 401 for an unauthenticated API request rather than redirecting", async () => {
    const response = proxy(request("/api/jobs"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it("rejects a forged cookie", () => {
    const response = proxy(request("/", "forged.token"));
    expect([307, 308]).toContain(response.status);
  });

  it("lets an authenticated request through", () => {
    const response = proxy(request("/", createSessionToken()));
    expect(response.status).toBe(200);
  });

  // Brief section 2.1: the cookie slides, so she is never asked to sign in again.
  it("re-issues the cookie on every authenticated request", () => {
    const response = proxy(request("/", createSessionToken()));

    const reissued = response.cookies.get(SESSION_COOKIE_NAME);
    expect(reissued).toBeDefined();
    expect(verifySessionToken(reissued?.value)).toBe(true);
    expect(reissued?.maxAge).toBe(400 * 24 * 60 * 60);
  });

  it("leaves the login page and login API reachable without a session", () => {
    expect(proxy(request("/login")).status).toBe(200);
    expect(proxy(request("/api/login")).status).toBe(200);
  });

  it("sends an already-signed-in visitor away from the login page", () => {
    const response = proxy(request("/login", createSessionToken()));

    expect([307, 308]).toContain(response.status);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/");
  });

  it("marks every response noindex, because this is a private site", () => {
    expect(proxy(request("/login")).headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(proxy(request("/", createSessionToken())).headers.get("X-Robots-Tag")).toBe(
      "noindex, nofollow",
    );
  });

  // Brief 4.5.
  it("sets the security headers on every response, with a fresh script nonce each time", () => {
    for (const response of [proxy(request("/login")), proxy(request("/", createSessionToken())), proxy(request("/api/jobs")), proxy(request("/settings"))]) {
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      const csp = response.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toMatch(/default-src 'self'/);
      expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
      expect(csp).toMatch(/frame-ancestors 'none'/);
      expect(csp).toMatch(/object-src 'none'/);
      expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    }
    const a = proxy(request("/login")).headers.get("Content-Security-Policy");
    const b = proxy(request("/login")).headers.get("Content-Security-Policy");
    expect(a).not.toBe(b);
  });

  it("does not put an open redirect in the next parameter", () => {
    const response = proxy(request("/api/../evil"));
    const location = response.headers.get("location");
    if (location) expect(new URL(location).host).toBe("localhost:3000");
  });
});
