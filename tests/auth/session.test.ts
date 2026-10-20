import { afterEach, describe, expect, it, vi } from "vitest";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";
import { resetEnvCache } from "@/lib/env";

const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(() => {
  process.env.SITE_PASSWORD = "correct-horse-battery-staple";
  process.env.APP_SECRET = Buffer.alloc(32, 7).toString("base64");
  resetEnvCache();
});

describe("session token", () => {
  it("round-trips a freshly minted token", () => {
    expect(verifySessionToken(createSessionToken())).toBe(true);
  });

  it("rejects missing, empty and malformed tokens without throwing", () => {
    expect(verifySessionToken(undefined)).toBe(false);
    expect(verifySessionToken(null)).toBe(false);
    expect(verifySessionToken("")).toBe(false);
    expect(verifySessionToken("no-separator")).toBe(false);
    expect(verifySessionToken(".onlysignature")).toBe(false);
    expect(verifySessionToken("onlypayload.")).toBe(false);
    expect(verifySessionToken("{}.{}")).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const token = createSessionToken();
    const [payload, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ v: 1, pf: "0".repeat(32), iat: Date.now() }),
    ).toString("base64url");

    expect(payload).toBeDefined();
    expect(verifySessionToken(`${forged}.${signature}`)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const token = createSessionToken();
    const [payload] = token.split(".");
    expect(verifySessionToken(`${payload}.${"A".repeat(43)}`)).toBe(false);
  });

  it("rejects a token signed with a different APP_SECRET", () => {
    const token = createSessionToken();
    process.env.APP_SECRET = Buffer.alloc(32, 9).toString("base64");
    resetEnvCache();
    expect(verifySessionToken(token)).toBe(false);
  });

  it("expires after 400 days and rejects future-dated tokens", () => {
    const now = Date.now();
    const token = createSessionToken(now);

    expect(verifySessionToken(token, now + 399 * DAY_MS)).toBe(true);
    expect(verifySessionToken(token, now + 401 * DAY_MS)).toBe(false);
    expect(verifySessionToken(createSessionToken(now + 10 * 60_000), now)).toBe(false);
  });

  // Brief section 2.1 / Phase 1 test list.
  it("stays valid across a server restart", async () => {
    const token = createSessionToken();

    // No server-side session store: reset every module and re-import, which is
    // what a restart does to in-memory state.
    vi.resetModules();
    const fresh = await import("@/lib/auth/session");

    expect(fresh.verifySessionToken(token)).toBe(true);
  });

  // Brief section 2.1: changing SITE_PASSWORD signs out every device.
  it("is invalidated when SITE_PASSWORD changes", () => {
    const token = createSessionToken();
    expect(verifySessionToken(token)).toBe(true);

    process.env.SITE_PASSWORD = "a-brand-new-password";
    resetEnvCache();

    expect(verifySessionToken(token)).toBe(false);
  });
});
