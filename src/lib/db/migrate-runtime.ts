import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getDb } from "./index";

const MIGRATIONS_FOLDER = resolve(process.cwd(), "drizzle");

/**
 * Applies any pending migrations. Idempotent — drizzle tracks what has run, so
 * this is safe to call on every server start and at the top of every test file.
 */
export function runMigrations(): void {
  if (!existsSync(MIGRATIONS_FOLDER)) {
    throw new Error(
      `No migrations found at ${MIGRATIONS_FOLDER}. Run \`npm run db:generate\` first.`,
    );
  }
  migrate(getDb(), { migrationsFolder: MIGRATIONS_FOLDER });
}
