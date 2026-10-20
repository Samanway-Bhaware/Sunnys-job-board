// Next.js 16 removed `next lint` (ESLint is run directly) and
// `eslint-config-next` now ships native flat config arrays — no FlatCompat.
// https://nextjs.org/docs/app/guides/upgrading/version-16#eslint-flat-config
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "data/**",
      "drizzle/**",
      "playwright-report/**",
      "test-results/**",
      "reference/**",
      "next-env.d.ts",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
];

export default config;
