/**
 * Downloads the live UK sponsor register into a throwaway database and reports
 * how a set of real creative-sector organisation names match against it.
 * No LLM involved; the only network call is to gov.uk.
 *
 *   npm run sponsor:check
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SITE_PASSWORD ??= "sponsor-check";
process.env.APP_SECRET ??= Buffer.alloc(32, 1).toString("base64");
process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "sponsor-check-")), "check.db");


/** Real organisations she'd plausibly see listings from. Some are known not to be sponsors. */
const NAMES: [string, string][] = [
  ["National Theatre of Scotland", "Glasgow"],
  ["Edinburgh International Festival", "Edinburgh"],
  ["Royal Lyceum Theatre", "Edinburgh"],
  ["Creative Scotland", "Edinburgh"],
  ["V&A Dundee", "Dundee"],
  ["Scottish Ballet", "Glasgow"],
  ["Scottish Opera", "Glasgow"],
  ["Edinburgh Festival Fringe Society", "Edinburgh"],
  ["National Galleries of Scotland", "Edinburgh"],
  ["National Museums Scotland", "Edinburgh"],
  ["Glasgow Life", "Glasgow"],
  ["Traverse Theatre", "Edinburgh"],
  ["Dundee Contemporary Arts", "Dundee"],
  ["Scottish Book Trust", "Edinburgh"],
  ["Publishing Scotland", "Edinburgh"],
  ["Royal Scottish National Orchestra", "Glasgow"],
  ["Citizens Theatre", "Glasgow"],
  ["Edinburgh Printmakers", "Edinburgh"],
  ["Fruitmarket Gallery", "Edinburgh"],
  ["Hospitalfield", "Arbroath"],
];

async function main(): Promise<void> {
const { runMigrations } = await import("@/lib/db/migrate-runtime");
const { closeDb } = await import("@/lib/db");
const { downloadRegister, matchSponsor } = await import("@/lib/sponsor/register");

runMigrations();
console.log("Downloading the live register…");
const started = Date.now();
const status = await downloadRegister();
console.log(`  ${status.available ? "ok" : "FAILED"} in ${((Date.now() - started) / 1000).toFixed(1)}s — ${status.rows} rows (aliases × routes) from ${status.sourceUrl}${status.lastError ? `\n  error: ${status.lastError}` : ""}\n`);

let matched = 0;
const t0 = Date.now();
for (const [name, town] of NAMES) {
  const m = matchSponsor(name, town);
  if (m) matched += 1;
  console.log(`  ${m ? "✓" : "·"} ${name.padEnd(36)} ${m ? `→ ${m.name} [${m.town}] ${m.rating} (${m.kind})` : "no match"}`);
}
console.log(`\n${matched} of ${NAMES.length} matched · ${((Date.now() - t0) / NAMES.length).toFixed(0)} ms per lookup`);
closeDb();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
