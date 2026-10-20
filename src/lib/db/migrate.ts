/** CLI entry point: `npm run db:migrate`. */
import { closeDb } from "./index";
import { runMigrations } from "./migrate-runtime";

try {
  runMigrations();
  console.log("Migrations applied.");
} catch (error) {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  closeDb();
}
