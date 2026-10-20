import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
