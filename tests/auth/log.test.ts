import { describe, expect, it, vi } from "vitest";
import { describeError, log, redactHeaders } from "@/lib/log";

describe("log redaction (brief 4.3)", () => {
  it("redacts Authorization, x-api-key, x-goog-api-key and cookies", () => {
    const headers = new Headers({
      Authorization: "Bearer sk-ant-secret-0000000000",
      "x-api-key": "sk-ant-secret-0000000000",
      "x-goog-api-key": "AIzaSecret00000000000000",
      cookie: "sunnynunny_session=abc.def",
      "content-type": "application/json",
    });
    const out = redactHeaders(headers);
    expect(out.authorization).toBe("[redacted]");
    expect(out["x-api-key"]).toBe("[redacted]");
    expect(out["x-goog-api-key"]).toBe("[redacted]");
    expect(out.cookie).toBe("[redacted]");
    expect(out["content-type"]).toBe("application/json");
    expect(JSON.stringify(out)).not.toMatch(/secret|AIza|abc\.def/);
  });

  it("describes errors without leaking keys that appear in messages", () => {
    const error = Object.assign(new Error("401 invalid x-api-key: sk-ant-api03-leak000000000"), { status: 401 });
    const text = describeError(error);
    expect(text).toMatch(/^Error 401: /);
    expect(text).not.toContain("sk-ant-api03");
    expect(text).toContain("[redacted]");
  });

  it("writes one scrubbed line per call", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("test", "failed calling provider", new Error("Bearer sk-live-0000000000000000"));
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toMatch(/error \[test\] failed calling provider — Error: /);
    expect(line).not.toContain("sk-live");
    spy.mockRestore();
  });
});
