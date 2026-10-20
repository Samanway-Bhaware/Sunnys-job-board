/**
 * Scraper live smoke test.
 *
 *   npm run smoke:refresh
 *
 * Runs one manual refresh against the real database using configured scrapers.
 */
import { assertEnv } from "@/lib/env";
import { runMigrations } from "@/lib/db/migrate-runtime";
import { seedDatabase } from "@/lib/db/seed";
import { closeDb } from "@/lib/db";
import { listJobs } from "@/lib/jobs/queries";
import { runRefreshAndWait } from "@/lib/refresh/run";
import { listRoles } from "@/lib/roles";
import { configuredScrapers } from "@/lib/scrapers";

async function main(): Promise<void> {
  assertEnv();
  await runMigrations();
  await seedDatabase();

  const activeScrapers = configuredScrapers().map((s) => s.name);
  const roles = new Map((await listRoles()).map((r) => [r.id, r.name]));

  console.log(`Active scrapers: ${activeScrapers.join(", ")}`);
  console.log(`Roles: ${[...roles.values()].join(", ")}\n`);

  const started = Date.now();
  const result = await runRefreshAndWait({ trigger: "manual" });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (!result.started) {
    console.log(`Refresh did not start: ${result.reason}${"message" in result ? ` — ${result.message}` : ""}`);
    return;
  }

  const run = result.run;
  console.log(`Run ${run.id}: ${run.status} in ${elapsed}s${run.error ? ` — ${run.error}` : ""}\n`);

  for (const [roleId, p] of Object.entries(run.progress)) {
    const name = roles.get(roleId) ?? roleId;
    console.log(`● ${name}: ${p.state}${p.error ? ` — ${p.error}` : ""} (${p.count ?? 0} jobs)`);
  }

  console.log("\nListings now on the board:");
  const jobs = await listJobs();
  for (const j of jobs.slice(0, 15)) {
    console.log(`  - [${j.source}] ${j.org} — ${j.title} (${j.locationText}) · ${j.linkStatus}\n      ${j.url}`);
  }
  if (jobs.length > 15) {
    console.log(`  ... and ${jobs.length - 15} more listings`);
  }
}

main()
  .catch((error: unknown) => {
    console.error("Smoke test failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
