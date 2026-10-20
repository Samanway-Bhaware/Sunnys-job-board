/** CLI entry point: `npm run db:migrate`. */
import { closeDb } from "./index";
import { runMigrations } from "./migrate-runtime";

async function main(): Promise<void> {
  try {
    await runMigrations();
    console.log("Migrations applied.");
  } catch (error) {
    console.error("Migration failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

main();
