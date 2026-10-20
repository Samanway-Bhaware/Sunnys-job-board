# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Private, single-user job board for creative-industry communications / marketing / business
development roles. An LLM with web search finds current listings server-side; she filters them
and tracks her applications. Not technical — the UI stays plain and obvious.

**Phase status: Phases 0–6 complete. Live calls pending RECONCILE #16; Docker build pending #18. See `PLAN.md`.**

---

## Commands

| Command | Does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build (`output: "standalone"`) |
| `npm start` | Run the built server |
| `npm run lint` | ESLint — **gate** |
| `npm run typecheck` | `tsc --noEmit` — **gate** |
| `npm test` | Vitest unit + integration — **gate** |
| `npm run test:e2e` | Builds, then the Playwright smoke test (mock provider, temp DB, no gov.uk download) |
| `npm run db:generate` | Generate a Drizzle migration from the schema (commit the `drizzle/` output) |
| `npm run db:migrate` | Apply migrations |
| `npm run smoke:refresh` | **Live** LLM call against the real DB — reads `.env`. Only with the owner's say-so |
| `npm run smoke:test -- anthropic\|openai\|gemini` | **Live** one-shot Test call for a provider — reads `.env`. Only with the owner's say-so |
| `npm run sponsor:check` | Downloads the live gov.uk sponsor register into a temp DB and reports matches for 20 real org names. No LLM |

Single test file: `npx vitest run tests/search/parse.test.ts` · by name: `npx vitest run -t "salvages"` ·
watch: `npm run test:watch`. Playwright needs a one-off `npx playwright install chromium`.

A phase is not finished until lint, typecheck and test all pass.

`npm start` runs `next start`, which is fine for checking a production build locally. The
deployed artifact is the standalone server: the Dockerfile copies `.next/standalone`,
`.next/static`, `public` and `drizzle` and runs `node server.js` (see `docs/deploy.md`). The standalone output is kept minimal by `outputFileTracingExcludes`
in `next.config.ts`; `drizzle/` is explicitly included because migrations run at startup.

Local dev with fixtures and no key: set `USE_MOCK_PROVIDER=1` in `.env`.

---

## Architecture

- **Next.js 16 App Router**, TypeScript `strict`, running as **one long-running Node server**.
  Not serverless: a refresh run takes 1-3 minutes and would hit a function timeout.
- **SQLite** via `better-sqlite3` + **Drizzle ORM** with migrations. One file, one volume.
- **zod at every boundary** — API inputs, LLM output, provider responses, env.
- **All LLM calls are server-side.** The browser never sees a key or a provider response.

```
src/
  proxy.ts              the auth gate + security headers (Next.js 16 renamed `middleware` to `proxy`)
  instrumentation.ts    server startup: validate env, run migrations
  app/                  routes + API handlers
  lib/
    env.ts              zod-validated env, fails fast
    log.ts              the only way server code logs: header redaction, key scrubbing
    security-headers.ts nonce CSP (strict script-src; style-src keeps unsafe-inline, RECONCILE #19)
    auth/               cookie signing, password check, rate limit, origin check, guard
    db/                 drizzle schema, migrations, seed
    jobs/               types, filter (pure, shared with the browser), merge/retention, queries, location
    roles/              CRUD, palette, delete-to-archive
    settings/           the settings singleton and search scope
    keys/
      crypto.ts         AES-256-GCM under an HKDF-derived key; unique IV per record
      store.ts          putKey / removeKey / keyStatus (masked) / resolveKey (decrypts at call time)
    search/
      schema.ts         the LLM output contract as zod
      prompt.ts         THE prompt — single file, easy to tweak
      parse.ts          shared parser: fences, prose, truncation salvage, per-item zod
      normalise.ts      work mode / contract / sponsorship / dates / GBP salary
      url.ts            canonical URLs
      linkcheck.ts      GET, 8 s, browser UA → verified | unverified | gone
      pipeline.ts       parse → normalise → link check → merge; returns per-step stats
      providers/        types, errors (ProviderError + scrub), index (resolution + model cache),
                        mock (fixtures), anthropic, openai (Responses API), gemini (Interactions API)
    refresh/
      run.ts            run records, per-role progress, concurrency 3
      policy.ts         cooldown, daily cap (default key only), DB lock stale after 10 min
    sponsor/
      register.ts       gov.uk page → current .csv → parse → replace table; matchSponsor; weekly refresh
      match.ts          token-set ratio + the guards in RECONCILE #15 — read it before touching thresholds
      normalise.ts      org-name normalisation, trading-name aliases
      csv.ts            RFC 4180 parser + formula-injection-safe writer (used by /api/export.csv)
    client/             browser-side fetch wrapper and formatting helpers
  components/board/     Board, JobRow, AddRoleDialog + the prototype's CSS as a module
  components/settings/  SettingsForm
```

### Auth
The gate lives in `src/proxy.ts`. Because the Next.js docs warn that a matcher change can
silently drop Server Function coverage, **every data route re-checks** with `requireSession()`
from `src/lib/auth/guard.ts` rather than trusting the gate alone.

The session cookie carries an HMAC fingerprint of the current SITE_PASSWORD, so changing that
password invalidates every cookie with no server-side session store — and a valid cookie keeps
working across restarts and redeploys, because the signature depends only on APP_SECRET.

**Provider adapters are interchangeable and thin.** Each one returns
`{ rawText, citedUrls, usage }` and nothing else. All parsing, validation, normalisation and
merging happens once, in the shared pipeline — never inside an adapter.

### Data rules worth knowing
- **Dedupe is global**, not per role (RECONCILE #14). A listing lives under the first role that found it.
- **Merge never touches status, notes or applied_at.** It fills blanks only.
- **Deleting a role** archives it if any job under it has a status; otherwise the row goes.
  Archived roles keep their jobs visible in the Archived tab and don't count toward the cap of 10.
- **`USE_MOCK_PROVIDER=1`** swaps in fixture listings (fictional orgs, `.example` URLs). Tests set it.
- **Sponsor matching would rather miss than guess.** Exact normalised match first; fuzzy only
  with ≥ 2 shared distinctive tokens covering ≥ 80%, and any tie declines. Every guard in
  `match.ts` was added because the live register produced a wrong match without it — add a
  failing pair to `tests/sponsor/match.test.ts` before loosening anything.
- Filters are one pure function, `applyFilters` in `src/lib/jobs/filter.ts`, run identically by the
  board and the tests. Filter state persists to localStorage and mirrors into the URL.

### Provider adapter rules
- An adapter returns `{ rawText, citedUrls, usage }` and **throws only `ProviderError`** with a
  plain, key-free message. Map SDK errors with `instanceof`; never pass a raw message through.
- The Anthropic adapter tries `web_search_20260318` and falls back to `web_search_20250305` on a
  400 that names the tool. It loops on `pause_turn` (max 4). Search-tool errors come back as
  HTTP 200 with an object in place of the results array — branch on `Array.isArray`.
- Tests inject a fake client via `create<Provider>Provider({ clientFactory })` and feed recorded-
  shape fixtures. No live calls in the suite, ever — `tests/keys/no-leak.test.ts` mocks the
  Anthropic module with an adversarial provider and asserts no key crosses any route.
- Anything a provider hands back that a route will serve (model labels, test messages, error
  text) passes through `scrub()` at the boundary. Keep it that way when adding routes.

### Refresh flow
Page load → `POST /api/refresh {trigger:"visit"}` → server runs only if the last success is
older than `REFRESH_COOLDOWN_MINUTES`, else returns cache. Manual button bypasses the cooldown.
One run at a time (DB lock, stale after 10 min). One provider call per enabled role,
concurrency 3. Progress in `refresh_runs`, client polls `GET /api/refresh/:id` every 2s.
`DAILY_REFRESH_CAP` applies **only** while the server's default key is in use.

---

## Security rules (non-negotiable — ask before changing any of these)

1. **No API key ever reaches the browser**, a response body, the client bundle, or the logs.
   The client sees only `{ hasUserKey, last4, hasDefault }`.
2. Her keys are **AES-256-GCM** encrypted at rest, key derived from `APP_SECRET` via HKDF,
   unique IV per record. Store ciphertext + IV + tag + last4. Decrypt only at call time.
3. **Redact** `Authorization`, `x-api-key`, `x-goog-api-key` from logs. Never log provider
   request bodies. Server code logs through `src/lib/log.ts`, never `console` directly.
4. State-changing requests pass an **Origin check** in addition to `SameSite=Lax`.
5. Headers: CSP, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
   `X-Robots-Tag: noindex, nofollow`, plus a noindex meta tag. This site is private.
6. **All LLM output is untrusted** — web pages carry prompt injection. Render strings as text
   only (never `dangerouslySetInnerHTML`), outbound links http(s) + `rel="noopener noreferrer"`,
   cap the length of every string field.
7. Password comparison is **timing-safe**; login is rate-limited to 5 failures / 15 min / IP.
8. Provider errors shown in the UI are sanitised and never echo a key.

Gemini's docs show the API key as a query parameter. **We send the `x-goog-api-key` header
instead** — a key in a URL leaks into access logs and `Referer`.

---

## Testing conventions

- `tests/setup.ts` runs before every file: sets a **test** password and secret, points
  `DATABASE_PATH` at a fresh temp SQLite file, sets `USE_MOCK_PROVIDER=1`, and runs migrations.
  Files run serially (`fileParallelism: false`) because each owns a DB file.
- `tests/helpers.ts`: `authed(path, {method, body})` builds a `NextRequest` that passes the
  session and origin checks; `anon()` doesn't; `params({id})` fakes Next's async route params;
  `resetTables()` wipes everything; `listing(overrides)` builds a `NormalisedListing`.
- Route handlers are tested by importing them directly (`import { POST } from "@/app/api/…/route"`)
  — no server. The proxy is tested the same way (`proxy(new NextRequest(...))`).
- Provider adapters are tested with an injected fake client and the recorded-shape fixtures
  in `tests/fixtures/anthropic/`. The only test that changes `process.env` must call
  `resetEnvCache()` and restore afterwards.

## Gotchas (each of these cost time once)

- **CSP nonces**: Next reads the nonce from the CSP on the *request* headers (set both request
  and response in the proxy). Every page must be dynamic — they all are (`force-dynamic`).
- **Playwright**: `getByRole("alert")` also matches Next's route announcer — scope it; and
  `toBeDisabled()` doesn't understand `<option>` — assert the attribute.
- **Next.js 16**: `middleware.ts` is `proxy.ts` (Node runtime only); `next lint` is gone;
  `params`/`searchParams`/`cookies()`/`headers()` are Promises; `eslint-config-next` exports
  flat-config arrays directly (no `FlatCompat`).
- **`resolve(process.cwd(), dynamic)` makes the standalone build copy the whole project** —
  Next's tracer special-cases that pattern. Use `resolve(dynamic)`; see `src/lib/db/index.ts`.
- **zod 4**: a missing object key is only accepted with an explicit `.optional()`; a union that
  includes `z.undefined()` is rejected.
- **better-sqlite3** must be in `serverExternalPackages`, and `instrumentation.ts` must guard on
  `process.env.NEXT_RUNTIME === "nodejs"` or the Edge compile fails resolving it.
- **Anthropic SDK** error classes are statics on the client (`Anthropic.BadRequestError`) and
  usable in `instanceof`, but they are not in the `Anthropic` type namespace.
- `@types/node` types `process.env.NODE_ENV` read-only; Vitest already sets it to `test`.
- The rate limiter's 5th failure is still a 401; the 429 comes from the pre-check on attempt 6.

## Conventions

- Sentence-case, plain English in all UI copy. Errors say what happened **and what to do next**.
- Search scope (what gets fetched) and filters (what gets shown) stay **separate**. The search
  deliberately fetches full-time *and* part-time, any sponsorship status — filters narrow the
  stored data client-side. Baking filters into the search would make the filters return nothing.
- Design tokens and fonts come from `reference/creative-job-board.jsx` — match it. Mobile
  stacking below 880px.
- Accessibility: visible focus, labelled controls, `aria-live` on refresh progress,
  `prefers-reduced-motion` respected.
- Never write `SITE_PASSWORD` into code, tests, fixtures or commits. Tests use their own
  password and secret set in the test setup.
- No live provider calls in the test suite — recorded fixtures or msw only.

---

## Working agreement

- **Verify, don't assume.** Provider APIs move fast. Check the official docs before writing an
  adapter, and put the doc URL in a code comment and in `docs/provider-notes.md`.
- **Report discrepancies, don't silently adapt.** Anything that contradicts the brief goes in
  `RECONCILE.md` as `[RECONCILE #n]` and into the phase report.
- **Phases are gated**, and the main branch must always run. Commit at the end of each phase.

### Stop and ask before:
- changing anything in the security rules above
- any live LLM call beyond the one smoke test per provider allowed in Phases 3 and 5
- adding a paid service, or scraping a site whose terms forbid it (LinkedIn, for example)
- continuing after a phase gate fails twice despite honest fix attempts
- resolving a RECONCILE item in a way that changes product behaviour

---

## Environment

See `.env.example` (placeholders only; `.env` is gitignored).
`SITE_PASSWORD`, `APP_SECRET`, `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID` (only for an
org-level key), `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEFAULT_PROVIDER`, `DEFAULT_MODEL`,
`REFRESH_COOLDOWN_MINUTES`, `DAILY_REFRESH_CAP`, `DATABASE_PATH`, `USE_MOCK_PROVIDER` (dev/test),
`SPONSOR_REGISTER_REFRESH` (set 0 to stop the scheduled gov.uk download; dev/test).

## Key references
- `README.md` (owner), `HOW-TO-USE.md` (her), `docs/deploy.md` (Fly.io / Railway / Docker / local)
- `PLAN.md` — phase-by-phase tasks and status
- `RECONCILE.md` — discrepancies and deferrals
- `docs/provider-notes.md` — verified API shapes, tool versions, doc URLs, pinned versions
- `reference/creative-job-board.jsx` — design and behaviour reference (**not** architecture:
  it calls the API from the browser; we never do)
