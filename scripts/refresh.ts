/**
 * Production scheduled refresh script (designed for GitHub Actions / cron).
 *
 *   npm run refresh
 *
 * Connects to Neon Postgres via DATABASE_URL, runs migrations, checks the sponsor
 * register, executes job scrapers for all enabled roles, deduplicates, and commits
 * updates directly to the database.
 */
import { assertEnv } from "@/lib/env";
import { runMigrations } from "@/lib/db/migrate-runtime";
import { seedDatabase } from "@/lib/db/seed";
import { closeDb } from "@/lib/db";
import { listJobs } from "@/lib/jobs/queries";
import { runRefreshAndWait } from "@/lib/refresh/run";
import { listRoles } from "@/lib/roles";
import { configuredScrapers } from "@/lib/scrapers";
import { downloadRegister, registerIsStale, registerStatus } from "@/lib/sponsor/register";

async function main(): Promise<void> {
  console.log("=== Sunnynunny Scheduled Refresh ===");
  console.log(`Started at: ${new Date().toISOString()}`);

  assertEnv();
  console.log("Running database migrations...");
  await runMigrations();

  console.log("Ensuring database seeding...");
  await seedDatabase();

  // Step 1: Check sponsor register
  try {
    if (await registerIsStale()) {
      console.log("Sponsor register is stale or missing. Downloading updated register from gov.uk...");
      const status = await downloadRegister();
      console.log(`Sponsor register: ${status.rows} rows available.`);
    } else {
      const status = await registerStatus();
      console.log(`Sponsor register is up to date (${status.rows} rows).`);
    }
  } catch (err) {
    console.warn("Sponsor register update skipped:", err instanceof Error ? err.message : err);
  }

  // Step 2: Scrapers check
  const activeScrapers = configuredScrapers().map((s) => s.name);
  const roles = await listRoles();
  const enabledRoles = roles.filter((r) => r.enabled);

  console.log(`Active scrapers (${activeScrapers.length}): ${activeScrapers.join(", ")}`);
  console.log(`Searching for ${enabledRoles.length} enabled role(s): ${enabledRoles.map((r) => r.name).join(", ")}\n`);

  if (enabledRoles.length === 0) {
    console.log("No enabled roles to refresh.");
    return;
  }

  // Step 3: Run refresh
  const started = Date.now();
  const result = await runRefreshAndWait({ trigger: "manual" });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (!result.started) {
    console.error(`Refresh could not start: ${result.reason}`);
    process.exitCode = 1;
    return;
  }

  const run = result.run;
  console.log(`\n=== Refresh Run ${run.id} Complete ===`);
  console.log(`Status: ${run.status} in ${elapsed}s ${run.error ? `(Error: ${run.error})` : ""}`);

  for (const [roleId, p] of Object.entries(run.progress)) {
    const roleName = roles.find((r) => r.id === roleId)?.name ?? roleId;
    console.log(`  ● ${roleName}: ${p.state} (${p.count ?? 0} jobs) ${p.error ? `[${p.error}]` : ""}`);
  }

  const allJobs = await listJobs();
  console.log(`\nTotal jobs currently stored: ${allJobs.length}`);
}

main()
  .catch((error: unknown) => {
    console.error("Scheduled refresh failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
    console.log(`Finished at: ${new Date().toISOString()}`);
  });

