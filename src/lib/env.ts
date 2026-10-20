import { z } from "zod";

/**
 * Environment loading and validation.
 */

const MIN_SECRET_BYTES = 32;

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

const EnvSchema = z.object({
  SITE_PASSWORD: z
    .string()
    .transform(stripWrappingQuotes)
    .pipe(z.string().min(1, "SITE_PASSWORD is required. Set it in .env — see .env.example.")),

  APP_SECRET: z
    .string()
    .transform(stripWrappingQuotes)
    .pipe(
      z
        .string()
        .min(1, "APP_SECRET is required. Set it in .env — see .env.example.")
        .refine((value) => value.length === 0 || decodeSecretBytes(value).length >= MIN_SECRET_BYTES, {
          message:
            `APP_SECRET must decode to at least ${MIN_SECRET_BYTES} bytes. Generate one with: ` +
            `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
        }),
    ),

  // FreeHire public API configuration (keyless by default)
  FREEHIRE_API_URL: z.string().url().default("https://freehire.me/api/v1"),
  FREEHIRE_API_KEY: emptyToUndefined(),

  REFRESH_COOLDOWN_MINUTES: z.coerce.number().int().min(0).default(120),

  DATABASE_URL: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      let cleaned = stripWrappingQuotes(v);
      if (cleaned.startsWith("psql ")) {
        cleaned = stripWrappingQuotes(cleaned.slice(5));
      }
      cleaned = cleaned.replace(/^p+ostgres(ql)?:\/\//i, "postgresql://");
      return cleaned || undefined;
    }),
  DATABASE_PATH: z.string().optional(),

  // Optional: for triggering GitHub Actions refresh workflow from UI
  GITHUB_TOKEN: emptyToUndefined(),
  GITHUB_REPO: emptyToUndefined(),

  /** Set to 0 to stop the scheduled gov.uk sponsor-register download (tests, offline dev). */
  SPONSOR_REGISTER_REFRESH: z
    .string()
    .optional()
    .transform((v) => !(v === "0" || v === "false")),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

function emptyToUndefined() {
  return z
    .string()
    .optional()
    .transform((value) => {
      const trimmed = value ? stripWrappingQuotes(value) : undefined;
      return trimmed && trimmed.length > 0 ? trimmed : undefined;
    });
}

export function decodeSecretBytes(value: string): Buffer {
  const base64 = Buffer.from(value, "base64");
  const roundTrips = base64.toString("base64").replace(/=+$/, "") === value.replace(/=+$/, "");
  return roundTrips && base64.length > 0 ? base64 : Buffer.from(value, "utf8");
}

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new Error(
      `Invalid environment configuration:\n${lines.join("\n")}\n\n` +
        `Copy .env.example to .env and fill it in.`,
    );
  }

  cached = parsed.data;
  return cached;
}

export function assertEnv(): void {
  getEnv();
}

export function resetEnvCache(): void {
  cached = null;
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === "production";
}
