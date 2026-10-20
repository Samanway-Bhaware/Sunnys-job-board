import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Section 5 of the brief: one long-running Node server, never serverless.
  // A refresh run takes 1-3 minutes and would hit a serverless function timeout.
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,

  // better-sqlite3 is a native addon: it must be required at runtime, not bundled.
  serverExternalPackages: ["better-sqlite3"],

  // The database path is dynamic (DATABASE_PATH), which makes Next's file tracer
  // want to copy the whole project into the standalone output. Bound that: the
  // server bundle is self-contained, and the only runtime files it reads from
  // disk are the migrations.
  outputFileTracingExcludes: {
    "/*": ["src/**/*", "tests/**/*", "e2e/**/*", "reference/**/*", "docs/**/*", "data/**/*", ".env*"],
  },
  outputFileTracingIncludes: {
    "/*": ["drizzle/**/*"],
  },
};

export default nextConfig;
