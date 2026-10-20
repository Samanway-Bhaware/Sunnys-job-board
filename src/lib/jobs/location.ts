import type { WorkMode } from "./types";

/**
 * Collapses free-text locations into the handful of labels the location filter
 * is built from ("Remote", "Edinburgh", "Glasgow", ...). Deliberately simple:
 * a known place name wins, otherwise the first comma-separated part.
 */
const KNOWN_PLACES = [
  "Edinburgh",
  "Glasgow",
  "Dundee",
  "Aberdeen",
  "Inverness",
  "Stirling",
  "Perth",
  "London",
  "Manchester",
  "Birmingham",
  "Leeds",
  "Bristol",
  "Liverpool",
  "Newcastle",
  "Sheffield",
  "Nottingham",
  "Brighton",
  "Oxford",
  "Cambridge",
  "York",
  "Bath",
  "Cardiff",
  "Belfast",
  "Exeter",
  "Norwich",
];

const REGIONS = ["Scotland", "England", "Wales", "Northern Ireland", "UK", "United Kingdom"];

export function normaliseLocation(text: string, workMode: WorkMode): string {
  const trimmed = text.trim();

  if (workMode === "remote" || /\bremote\b/i.test(trimmed)) return "Remote";
  if (!trimmed) return "";

  const lower = trimmed.toLowerCase();
  for (const place of KNOWN_PLACES) {
    if (new RegExp(`\\b${place.toLowerCase()}\\b`).test(lower)) return place;
  }
  for (const region of REGIONS) {
    if (new RegExp(`\\b${region.toLowerCase()}\\b`).test(lower)) {
      return region === "United Kingdom" ? "UK" : region;
    }
  }

  const first = trimmed.split(/[,/|]/)[0]?.trim() ?? "";
  return first.replace(/\b(hybrid|on-?site|office-based)\b/gi, "").replace(/\s+/g, " ").trim();
}
