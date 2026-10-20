/**
 * Runs once when the server starts.
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */
export async function register(): Promise<void> {
  // Next compiles instrumentation for every runtime it supports. The database is
  // a native addon and only exists on the Node server, so guard the import —
  // without this the Edge compilation fails trying to resolve better-sqlite3.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertEnv } = await import("@/lib/env");
  const { runMigrations } = await import("@/lib/db/migrate-runtime");
  const { seedDatabase } = await import("@/lib/db/seed");
  const { scheduleRegisterRefresh } = await import("@/lib/sponsor/register");

  // Fail fast: a server with no SITE_PASSWORD or APP_SECRET must not start.
  assertEnv();
  runMigrations();
  seedDatabase();
  // Sponsor register: refreshed in the background if older than 7 days. Never blocks boot.
  scheduleRegisterRefresh();
}
