import { describe, expect, it } from "vitest";
import { passwordFingerprint, verifyPassword } from "@/lib/auth/password";
import { resetEnvCache } from "@/lib/env";

describe("password", () => {
  it("accepts the configured password", () => {
    expect(verifyPassword("correct-horse-battery-staple")).toBe(true);
  });

  it("rejects a wrong password", () => {
    expect(verifyPassword("not-the-password")).toBe(false);
    expect(verifyPassword("correct-horse-battery-stapl")).toBe(false);
    expect(verifyPassword("correct-horse-battery-staple ")).toBe(false);
  });

  it("rejects empty and non-string input without throwing", () => {
    expect(verifyPassword("")).toBe(false);
    expect(verifyPassword(undefined as unknown as string)).toBe(false);
    expect(verifyPassword(null as unknown as string)).toBe(false);
  });

  it("never reveals the password in the fingerprint", () => {
    const fingerprint = passwordFingerprint();
    expect(fingerprint).not.toContain("correct-horse");
    expect(fingerprint).toMatch(/^[0-9a-f]{32}$/);
  });

  it("changes the fingerprint when SITE_PASSWORD changes", () => {
    const before = passwordFingerprint();
    process.env.SITE_PASSWORD = "a-different-password";
    resetEnvCache();
    const after = passwordFingerprint();

    process.env.SITE_PASSWORD = "correct-horse-battery-staple";
    resetEnvCache();

    expect(after).not.toBe(before);
  });
});
