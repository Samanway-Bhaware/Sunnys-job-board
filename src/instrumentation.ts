/**
 * Runs once when the server starts.
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertEnv } = await import("@/lib/env");
  const { ensureSeeded } = await import("@/lib/db/seed");
  const { scheduleRegisterRefresh } = await import("@/lib/sponsor/register");
  const { log } = await import("@/lib/log");

  assertEnv();

  try {
    await ensureSeeded();
  } catch (error) {
    log.error("db", "Startup migration/seed warning (will retry on request)", error);
  }

  // On Vercel serverless, background register refresh is handled by GitHub Actions (scripts/refresh.ts)
  // rather than downloading a 15MB CSV inside a short-lived web function.
  if (!process.env.VERCEL) {
    scheduleRegisterRefresh();
  }
}
