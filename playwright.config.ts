import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * Brief Phase 6 smoke test. Runs the production build against the mock provider
 * with a throwaway database and a test password. `npm run test:e2e` builds first.
 */
const PORT = 3900;
export const E2E_PASSWORD = "e2e-password-not-real";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      SITE_PASSWORD: E2E_PASSWORD,
      APP_SECRET: Buffer.alloc(32, 5).toString("base64"),
      DATABASE_PATH: join(mkdtempSync(join(tmpdir(), "sunnynunny-e2e-")), "e2e.db"),
      USE_MOCK_PROVIDER: "1",
      REFRESH_COOLDOWN_MINUTES: "120",
      DAILY_REFRESH_CAP: "20",
      SPONSOR_REGISTER_REFRESH: "0",
      // Keep the real .env out of it: no provider keys, no workspace id.
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
    },
  },
});
