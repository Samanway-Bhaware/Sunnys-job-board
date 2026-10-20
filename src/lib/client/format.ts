/** Display helpers. Client-safe: no server imports. */

export function ago(ts: number | null | undefined, now: number = Date.now()): string {
  if (!ts) return "never";
  const s = Math.round((now - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return `${d} day${d > 1 ? "s" : ""} ago`;
}

export type Tone = "" | "muted" | "soon";

export function closingInfo(closing: string | null, today: string): { text: string; tone: Tone } {
  if (!closing) return { text: "Not given", tone: "muted" };
  const d = new Date(`${closing}T00:00:00`);
  const label = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const days = Math.round((d.getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000);
  if (days < 0) return { text: `Closed ${label}`, tone: "muted" };
  if (days === 0) return { text: "Closes today", tone: "soon" };
  if (days <= 7) return { text: `${label}, ${days} day${days === 1 ? "" : "s"} left`, tone: "soon" };
  return { text: label, tone: "" };
}

/** "Communications, marketing and business development" */
export function joinRoles(names: string[]): string {
  const r = names.map((x, i) => (i > 0 && /^[A-Z][a-z]/.test(x) ? x[0]!.toLowerCase() + x.slice(1) : x));
  if (r.length <= 1) return r[0] ?? "";
  return `${r.slice(0, -1).join(", ")} and ${r[r.length - 1]}`;
}

export function trimDot(s: string): string {
  return s.replace(/[.\s]+$/, "");
}

/** Today in Europe/London as YYYY-MM-DD, computed in the browser. */
export function todayLondon(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
