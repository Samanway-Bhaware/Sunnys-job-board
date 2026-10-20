/**
 * Strips sensitive keys and caps string length.
 */
const KEY_PATTERN = /(sk-ant-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{10,}|AQ\.[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9_.-]+)/g;

export function scrub(text: string, max = 200): string {
  const clean = text.replace(KEY_PATTERN, "[redacted]").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
