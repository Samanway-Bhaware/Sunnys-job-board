import { scrub } from "@/lib/scrub";

/**
 * Brief 4.3: Authorization, x-api-key and x-goog-api-key never reach the logs,
 * and provider request bodies are never logged at all. Server code logs through
 * here, never through console directly.
 */

const SECRET_HEADERS = /^(authorization|x-api-key|x-goog-api-key|cookie|set-cookie)$/i;

export function redactHeaders(headers: Headers | Record<string, string> | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headers) return out;
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  for (const [key, value] of entries) out[key] = SECRET_HEADERS.test(key) ? "[redacted]" : scrub(value, 300);
  return out;
}

/** A one-line, key-free description of an error for the server log. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status;
    return `${error.name}${typeof status === "number" ? ` ${status}` : ""}: ${scrub(error.message, 300)}`;
  }
  return scrub(String(error), 300);
}

function line(level: "info" | "warn" | "error", scope: string, message: string): string {
  return `${new Date().toISOString()} ${level.padEnd(5)} [${scope}] ${scrub(message, 1000)}`;
}

export const log = {
  info(scope: string, message: string): void {
    console.log(line("info", scope, message));
  },
  warn(scope: string, message: string): void {
    console.warn(line("warn", scope, message));
  },
  /** Pass the error object; only its name, status and scrubbed message are written. */
  error(scope: string, message: string, error?: unknown): void {
    console.error(line("error", scope, error === undefined ? message : `${message} — ${describeError(error)}`));
  },
};
