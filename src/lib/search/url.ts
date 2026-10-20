/**
 * Canonical URLs (brief section 2.5 step 3): only http(s), tracking parameters
 * and the fragment stripped, so the same listing reached by two links dedupes.
 */

const TRACKING_PARAMS = new Set([
  "gclid",
  "dclid",
  "fbclid",
  "msclkid",
  "twclid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "ref_src",
  "trk",
  "trkCampaign",
]);

function isTrackingParam(name: string): boolean {
  return name.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(name);
}

/** Returns null for anything that is not a usable http(s) URL. */
export function canonicalUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }

  for (const name of [...url.searchParams.keys()]) {
    if (isTrackingParam(name)) url.searchParams.delete(name);
  }
  url.searchParams.sort();

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

/** A user-facing safety check for outbound links (brief section 4.6). */
export function isSafeHttpUrl(raw: string): boolean {
  return canonicalUrl(raw) !== null;
}

export function hostnameOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
