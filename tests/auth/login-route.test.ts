import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/login/route";
import { POST as logout } from "@/app/api/logout/route";
import { MAX_FAILURES } from "@/lib/auth/rate-limit";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { loginAttempts } from "@/lib/db/schema";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";

function post(path: string, body: unknown, ip: string, origin: string | null = ORIGIN) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "x-forwarded-for": ip,
    host: "localhost:3000",
  });
  if (origin) headers.set("origin", origin);

  return new NextRequest(`${ORIGIN}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await getDb().delete(loginAttempts);
});

describe("POST /api/login", () => {
  it("rejects a wrong password with 401 and sets no cookie", async () => {
    const response = await login(post("/api/login", { password: "wrong" }, "10.0.0.1"));

    expect(response.status).toBe(401);
    expect(response.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it("accepts the right password and sets a valid, hardened cookie", async () => {
    const response = await login(post("/api/login", { password: PASSWORD }, "10.0.0.2"));

    expect(response.status).toBe(200);

    const cookie = response.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(verifySessionToken(cookie?.value)).toBe(true);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    // 400 days, the browser cap.
    expect(cookie?.maxAge).toBe(400 * 24 * 60 * 60);
  });

  it("never echoes the password back in the response body", async () => {
    const response = await login(post("/api/login", { password: PASSWORD }, "10.0.0.3"));
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain(PASSWORD);
  });

  it("rejects a malformed body with 400", async () => {
    const response = await login(post("/api/login", { password: 123 }, "10.0.0.4"));
    expect(response.status).toBe(400);
  });

  it("rejects a cross-site origin with 403", async () => {
    const response = await login(
      post("/api/login", { password: PASSWORD }, "10.0.0.5", "https://evil.example"),
    );
    expect(response.status).toBe(403);
    expect(response.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("allows a request with no Origin header (non-browser client)", async () => {
    const response = await login(post("/api/login", { password: PASSWORD }, "10.0.0.6", null));
    expect(response.status).toBe(200);
  });
});

describe("login rate limiting", () => {
  // Brief section 2.1 / Phase 1 test list: the limit triggers on the 6th failure.
  it("allows 5 failures then returns 429 on the 6th", async () => {
    const ip = "10.0.1.1";

    for (let attempt = 1; attempt <= MAX_FAILURES; attempt += 1) {
      const response = await login(post("/api/login", { password: "wrong" }, ip));
      expect(response.status, `attempt ${attempt} should still be a plain rejection`).toBe(401);
    }

    const blocked = await login(post("/api/login", { password: "wrong" }, ip));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();

    const body = (await blocked.json()) as { message: string };
    expect(body.message).toMatch(/try again in about/i);
  });

  it("blocks the correct password too once the limit is hit, and says when to retry", async () => {
    const ip = "10.0.1.2";
    for (let attempt = 0; attempt < MAX_FAILURES; attempt += 1) {
      await login(post("/api/login", { password: "wrong" }, ip));
    }

    const response = await login(post("/api/login", { password: PASSWORD }, ip));
    expect(response.status).toBe(429);
    expect(response.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("limits per IP, so one IP's failures do not lock out another", async () => {
    const noisy = "10.0.1.3";
    for (let attempt = 0; attempt < MAX_FAILURES; attempt += 1) {
      await login(post("/api/login", { password: "wrong" }, noisy));
    }

    const other = await login(post("/api/login", { password: PASSWORD }, "10.0.1.4"));
    expect(other.status).toBe(200);
  });

  it("clears the failure count after a successful sign-in", async () => {
    const ip = "10.0.1.5";
    for (let attempt = 0; attempt < MAX_FAILURES - 1; attempt += 1) {
      await login(post("/api/login", { password: "wrong" }, ip));
    }

    await login(post("/api/login", { password: PASSWORD }, ip));

    // The slate is clean, so a fresh run of failures is allowed again.
    for (let attempt = 1; attempt <= MAX_FAILURES; attempt += 1) {
      const response = await login(post("/api/login", { password: "wrong" }, ip));
      expect(response.status).toBe(401);
    }
  });
});

describe("POST /api/logout", () => {
  it("clears the session cookie", async () => {
    const response = await logout(post("/api/logout", {}, "10.0.2.1"));
    expect(response.status).toBe(200);

    const cookie = response.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie?.value).toBe("");
    expect(cookie?.maxAge).toBe(0);
  });

  it("rejects a cross-site origin", async () => {
    const response = await logout(post("/api/logout", {}, "10.0.2.2", "https://evil.example"));
    expect(response.status).toBe(403);
  });
});
