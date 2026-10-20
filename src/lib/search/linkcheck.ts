import type { LinkStatus } from "@/lib/jobs/types";

/**
 * Brief 2.5 step 5. GET with an 8 s timeout and a normal browser user agent.
 *   404 / 410            → "gone"        (drop the listing)
 *   2xx / 3xx            → "verified"
 *   401 / 403 / 429,
 *   timeout, network err → "unverified"  (keep it — many job boards block bots)
 */

export type LinkCheckResult = LinkStatus | "gone";

export const LINK_TIMEOUT_MS = 8000;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/128.0.0.0 Safari/537.36";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export async function checkLink(
  url: string,
  options: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<LinkCheckResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? LINK_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });
    // Don't hold the body; we only wanted the status.
    try {
      await response.body?.cancel();
    } catch {
      /* ignore */
    }

    const status = response.status;
    if (status === 404 || status === 410) return "gone";
    if (status >= 200 && status < 400) return "verified";
    return "unverified";
  } catch {
    // Timeout, DNS failure, TLS error, connection refused: all "unverified".
    return "unverified";
  } finally {
    clearTimeout(timer);
  }
}

/** Checks many links with bounded parallelism. */
export async function checkLinks(
  urls: string[],
  options: { fetchImpl?: FetchLike; timeoutMs?: number; concurrency?: number } = {},
): Promise<Map<string, LinkCheckResult>> {
  const results = new Map<string, LinkCheckResult>();
  const queue = [...new Set(urls)];
  const workers = Array.from({ length: Math.min(options.concurrency ?? 6, queue.length) }, async () => {
    while (queue.length > 0) {
      const url = queue.shift()!;
      results.set(url, await checkLink(url, options));
    }
  });
  await Promise.all(workers);
  return results;
}
