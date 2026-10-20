import { beforeAll } from "vitest";
import { runMigrations } from "@/lib/db/migrate-runtime";

/**
 * Tests use their own password and secret (brief section 3). The real
 * SITE_PASSWORD is never written into code, tests, fixtures or commits.
 */
process.env.SITE_PASSWORD = "correct-horse-battery-staple";
process.env.APP_SECRET = Buffer.alloc(32, 7).toString("base64");
process.env.DATABASE_URL = ":memory:";
process.env.USE_MOCK_PROVIDER = "1";

beforeAll(async () => {
  await runMigrations();
});
