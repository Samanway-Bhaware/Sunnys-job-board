/**
 * Scraper live test script.
 *
 *   npx tsx scripts/live-test.ts [reed|adzuna|arbeitnow|remotive|govuk]
 */
import { ALL_SCRAPERS } from "@/lib/scrapers";

async function main(): Promise<void> {
  const id = process.argv[2];
  const target = id ? ALL_SCRAPERS.find((s) => s.id === id) : null;

  const toTest = target ? [target] : ALL_SCRAPERS;

  console.log(`Testing ${toTest.length} scraper(s)...\n`);

  for (const scraper of toTest) {
    console.log(`Checking ${scraper.name} (${scraper.id}):`);
    console.log(`  Configured: ${scraper.isConfigured() ? "YES" : "NO (needs API key)"}`);

    if (!scraper.isConfigured()) {
      console.log(`  Skipping scrape test.\n`);
      continue;
    }

    const res = await scraper.scrape({
      keywords: ["communications", "marketing"],
      locations: ["Remote", "London", "Edinburgh"],
      sector: "Creative industries",
    });

    console.log(`  Result: ${res.jobs.length} jobs found in ${res.durationMs}ms`);
    if (res.error) console.log(`  Error: ${res.error}`);
    if (res.jobs.length > 0) {
      console.log(`  Sample: "${res.jobs[0]?.title}" at ${res.jobs[0]?.org} (${res.jobs[0]?.url})`);
    }
    console.log("");
  }
}

main().catch((e: unknown) => {
  console.error("Scraper test failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
