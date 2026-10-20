/**
 * Runs once when the server starts.
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertEnv } = await import("@/lib/env");
  const { runMigrations } = await import("@/lib/db/migrate-runtime");
  const { seedDatabase } = await import("@/lib/db/seed");
  const { scheduleRegisterRefresh } = await import("@/lib/sponsor/register");

  assertEnv();
  await runMigrations();
  await seedDatabase();
  scheduleRegisterRefresh();
}
