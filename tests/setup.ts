import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Tests use their own password and secret (brief section 3). The real
 * SITE_PASSWORD is never written into code, tests, fixtures or commits.
 */
process.env.SITE_PASSWORD = "correct-horse-battery-staple";
process.env.APP_SECRET = Buffer.alloc(32, 7).toString("base64");
// Vitest already sets NODE_ENV to "test"; @types/node types it read-only.

// One throwaway SQLite file per test file, so the rate-limit tests cannot
// interfere with each other.
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "sunnynunny-")), "test.db");
process.env.USE_MOCK_PROVIDER = "1";

const { runMigrations } = await import("@/lib/db/migrate-runtime");
runMigrations();
